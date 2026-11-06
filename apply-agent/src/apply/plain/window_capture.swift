// A plain Worker's own Chrome window, streamed with ScreenCaptureKit (KAN-635).
//
//   window-capture --check
//       exit 0 with Screen Recording permission, 3 without. Never asks for it.
//   window-capture --pid <chrome pid> [--fps 30] [--quality 0.85]
//       reads targets on stdin, one a line: "<left> <top> <width> <height> <viewport w> <viewport h> <title>",
//       the shown Chrome window's bounds, its tab's viewport, in points, and the tab's title. It streams
//       that window of <pid>: the only one whose title is the tab's (KAN-717), cropped to the viewport
//       (the bottom of the window, under Chrome's toolbar), at the screen's pixel scale. With no such
//       window, or more than one, it stops and says "mismatch": never another window. Each frame goes
//       to stdout as a 4-byte big-endian length, then a JPEG. Status lines (JSON) go to stderr, each
//       with the pid, and the window's ID and title once it streams one.
//
// The window is captured by its ID, wherever it is and whatever covers it: nothing is focused,
// raised or moved. A minimized window sends nothing.

import CoreGraphics
import CoreImage
import CoreMedia
import Foundation
import ScreenCaptureKit

func say(_ fields: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: fields), let line = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
    }
}

let arguments = CommandLine.arguments
func option(_ name: String) -> String? {
    guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
    return arguments[i + 1]
}

if arguments.contains("--check") {
    exit(CGPreflightScreenCaptureAccess() ? 0 : 3)
}
let pid = Int32(option("--pid") ?? "") ?? 0
if pid <= 0 {
    say(["error": "usage: window-capture --pid <pid> [--fps 30] [--quality 0.85]"])
    exit(2)
}
if !CGPreflightScreenCaptureAccess() {
    say(["error": "permission"])
    exit(3)
}
let fps = Double(option("--fps") ?? "30") ?? 30
let quality = Double(option("--quality") ?? "0.85") ?? 0.85

struct Target: Equatable {
    var bounds: CGRect
    var viewport: CGSize
    var title: String
}

// Whether a window's title (as macOS lists it) is the tab's: macOS may add " - Google Chrome…" at the end and cut
// a long title in the middle with "…", keeping at least `ends` characters of each end. The same rule as
// window_capture.title_matches.
let ends = 8
func titleMatches(_ window: String?, _ tab: String) -> Bool {
    func squeeze(_ text: String) -> String { text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
    var shown = squeeze(window ?? "")
    let wanted = squeeze(tab)
    if shown.isEmpty || wanted.isEmpty { return false }
    if shown == wanted { return true }
    if let suffix = shown.range(of: #" - Google Chrome(?: for Testing)?(?: - [^…]{1,60})?$"#, options: .regularExpression) {
        shown = String(shown[..<suffix.lowerBound]).trimmingCharacters(in: .whitespaces)
    }
    if shown == wanted { return true }
    let parts = shown.components(separatedBy: "…")
    guard parts.count == 2 else { return false }
    let head = parts[0].trimmingCharacters(in: .whitespaces), tail = parts[1].trimmingCharacters(in: .whitespaces)
    return head.count >= ends && tail.count >= ends && wanted.count > head.count + tail.count
        && wanted.hasPrefix(head) && wanted.hasSuffix(tail)
}

final class Output: NSObject, SCStreamOutput, SCStreamDelegate {
    let context = CIContext()
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let out = FileHandle.standardOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(buffer), capturer.sending else { return }
        let image = CIImage(cvPixelBuffer: pixels)
        let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality]
        guard let jpeg = context.jpegRepresentation(of: image, colorSpace: space, options: options) else { return }
        var length = UInt32(jpeg.count).bigEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(jpeg)
        out.write(frame)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        say(["stopped": error.localizedDescription])
        capturer.stopped()
    }
}

final class Capturer {
    let output = Output()
    let queue = DispatchQueue(label: "window-capture.frames")
    var stream: SCStream?
    var window: CGWindowID = 0
    var target: Target?
    let lock = NSLock()
    var _sending = false // frames go out only while the window streamed is verified as the Worker's, with the tab's title
    var sending: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _sending }
        set { lock.lock(); _sending = newValue; lock.unlock() }
    }

    func stopped() {
        lock.lock(); stream = nil; window = 0; _sending = false; lock.unlock()
    }

    // The one window of <pid> titled as the tab; a few looks, as macOS lists a new title a moment late. A page sets
    // its own title, so two windows titled alike are no proof of either: nil, and the tile takes the extension's frames.
    func find(_ wanted: Target) async throws -> SCWindow? {
        for look in 0..<8 {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            let mine = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0
                && titleMatches($0.title, wanted.title) }
            if mine.count == 1 { return mine[0] }
            if mine.count > 1 { return nil }
            if look < 7 { try await Task.sleep(nanoseconds: 150_000_000) }
        }
        return nil
    }

    func follow(_ wanted: Target) async {
        do {
            guard let found = try await find(wanted) else {
                sending = false
                if let old = stream { try? await old.stopCapture() }
                stopped()
                say(["mismatch": "no one window of pid \(pid) titled as its tab", "pid": Int(pid), "title": wanted.title])
                return
            }
            let filter = SCContentFilter(desktopIndependentWindow: found)
            let scale = CGFloat(filter.pointPixelScale)
            let width = min(wanted.viewport.width, found.frame.width)
            let height = min(wanted.viewport.height, found.frame.height)
            let config = SCStreamConfiguration()
            config.sourceRect = CGRect(x: (found.frame.width - width) / 2, y: found.frame.height - height, width: width, height: height)
            config.width = Int(width * scale)
            config.height = Int(height * scale)
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
            config.pixelFormat = kCVPixelFormatType_32BGRA
            config.showsCursor = false
            config.queueDepth = 4
            config.colorSpaceName = CGColorSpace.sRGB
            if let stream, window == found.windowID {
                try await stream.updateConfiguration(config)
            } else {
                sending = false
                if let old = stream { try? await old.stopCapture() }
                let fresh = SCStream(filter: filter, configuration: config, delegate: output)
                try fresh.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
                try await fresh.startCapture()
                stream = fresh
                window = found.windowID
            }
            sending = true
            say(["window": Int(found.windowID), "pid": Int(pid), "title": found.title ?? "", "width": config.width,
                 "height": config.height, "scale": Double(scale)])
        } catch {
            say(["error": error.localizedDescription])
        }
    }
}

let capturer = Capturer()

Task.detached {
    while let line = readLine() {
        let parts = line.split(separator: " ", maxSplits: 6, omittingEmptySubsequences: false)
        let n = parts.prefix(6).compactMap { Double($0) }
        guard n.count == 6, parts.count == 7, !parts[6].isEmpty else { continue } // no title: nothing it could verify
        let wanted = Target(bounds: CGRect(x: n[0], y: n[1], width: n[2], height: n[3]), viewport: CGSize(width: n[4], height: n[5]),
                            title: String(parts[6]))
        await capturer.follow(wanted)
    }
    exit(0) // stdin closed: Apply is done with this window
}

dispatchMain()
