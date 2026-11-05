// A plain Worker's own Chrome window, streamed with ScreenCaptureKit (KAN-635).
//
//   window-capture --check
//       exit 0 with Screen Recording permission, 3 without. Never asks for it.
//   window-capture --pid <chrome pid> [--fps 30] [--quality 0.85]
//       reads targets on stdin, one a line: "<left> <top> <width> <height> <viewport w> <viewport h>",
//       the shown Chrome window's bounds and its tab's viewport, in points. It streams that window
//       of <pid> (the one whose frame is nearest those bounds), cropped to the viewport (the bottom
//       of the window, under Chrome's toolbar), at the screen's pixel scale. Each frame goes to
//       stdout as a 4-byte big-endian length, then a JPEG. Status lines (JSON) go to stderr.
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
}

final class Output: NSObject, SCStreamOutput, SCStreamDelegate {
    let context = CIContext()
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let out = FileHandle.standardOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
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

    func stopped() {
        lock.lock(); stream = nil; window = 0; lock.unlock()
    }

    func follow(_ wanted: Target) async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            let mine = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
            func distance(_ w: SCWindow) -> CGFloat {
                abs(w.frame.minX - wanted.bounds.minX) + abs(w.frame.minY - wanted.bounds.minY)
                    + abs(w.frame.width - wanted.bounds.width) + abs(w.frame.height - wanted.bounds.height)
            }
            guard let found = mine.min(by: { distance($0) < distance($1) }) else {
                say(["error": "no window of pid \(pid)"])
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
                if let old = stream { try? await old.stopCapture() }
                let fresh = SCStream(filter: filter, configuration: config, delegate: output)
                try fresh.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
                try await fresh.startCapture()
                stream = fresh
                window = found.windowID
            }
            say(["window": Int(found.windowID), "width": config.width, "height": config.height, "scale": Double(scale)])
        } catch {
            say(["error": error.localizedDescription])
        }
    }
}

let capturer = Capturer()

Task.detached {
    while let line = readLine() {
        let n = line.split(separator: " ").compactMap { Double($0) }
        guard n.count == 6 else { continue }
        let wanted = Target(bounds: CGRect(x: n[0], y: n[1], width: n[2], height: n[3]), viewport: CGSize(width: n[4], height: n[5]))
        await capturer.follow(wanted)
    }
    exit(0) // stdin closed: Apply is done with this window
}

dispatchMain()
