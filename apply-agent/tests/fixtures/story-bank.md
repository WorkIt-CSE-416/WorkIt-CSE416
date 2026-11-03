# Story bank: Test Person

The tests' Story bank: invented, in the shape of a real one, holding the
episodes the tests quote (the depot tracker, the geofence, the outage fix).

## Test's own essays
My favorite project is the depot tracker I led as an intern. Dispatchers could not tell which bus was parked where, so every morning someone walked the whole yard with a clipboard and wrote down fleet numbers by hand, which took close to an hour and was out of date by the time it reached the office. I pitched a camera on the roof that reads every bus. Then thirteen of us built it. By the demo it found each bus in under a second, and the dispatch team asked for its installation in the other depots after the presentation.

The hardest bug I have fixed was a vehicle setting that never saved. The screen said it worked. But the old value came back after a refresh, and nobody on the team could say why, because the request looked fine in the logs and the validation passed and the database showed no error at all. I reproduced it, and then I traced the request through the data layer until I saw that empty values were skipped on purpose. One check. I changed it and added a test, so a cleared field now stays cleared.

I like teaching what I just learned. When our Micromouse team got new members who had never touched embedded code, I wrote a one-page guide to our firmware with the configuration we use: where the control loop lives, how to flash the board, and which tests to run before a push. It helped. Two new members fixed real bugs in their first month, and they still send the next group to that page for orientation.

At my last internship I learned that a fix nobody can see is not done. I had cut a slow report from four minutes to twenty seconds, but the team still ran it at night out of habit, since the old one had always slowed everything else down during the day and nobody had told them about the improvement. So I added a line saying when it last ran and how long it took. It worked. Within a week they ran it in the morning before standup.

I chose computer science because a few lines of code can change what a machine does. In high school our robot sat still for weeks, with no budget and no lab, while I rewrote the camera code after every practice until the detection finally held up under the gym lights. Then suddenly it could see the field. That moment is why I still build things that move. It is also my motivation for the math.

I use AI tools as a guide, not as the author. On a big C# codebase an agent helped me find my way around the documentation and the services, but it also pointed me at files that did not exist and at functions with the wrong arguments, so I learned to check what it says against the code and the tests before I trust it. The code in my pull requests is mine. It goes through review.

## Test's own answers, word for word
- Why this field: I chose computer science because a few lines of code can change what a machine does, and that still surprises me.
- How I use AI tools: I use an agent to find my way around a big codebase and its documentation, and then I check what it says against the tests. Always.

## Education
- Example State University, B.S. Computer Science, expected May 2028. GPA 3.85/4.0.
- Coursework: Data Structures, Algorithms, Systems Fundamentals, Theory of Computation.
- Applying for Summer 2027 software engineering and AI/ML internships.

## Hitachi Rail: Software Engineer Intern, Onboard Systems (Jun-Aug 2026)
- Built live-feed adapters in C# so agencies that send bus positions in other formats show up on the same dispatch map; the first agency's feed sent 4,009 updates in its test day.

### Intern project: computer-vision depot bus tracker (lead, 13-intern team)
- Why: cheap, accurate real-time tracking of buses in a depot from one overhead camera; he pitched it to the team lead.
- Built a PyTorch YOLOv8-OBB detector (rotated boxes, since buses park at angles) and a tracker that keeps each bus's fleet number.
- Results: sub-second detection on the depot feed; every whitelisted fleet number read correctly in the demo.

## Cloud Data Pro: Software Engineer (Part-Time) (Jan 2026-present, remote; PHP, WordPress, TypeScript, Playwright)
- Rebuilt a nonprofit's site as a custom WordPress block theme; CI runs Playwright end-to-end tests on every push.

## Clever Devices: Software Engineer Intern (Jun-Aug 2025; C#, SQL, Python)
- Fixed a Fleet Manager REST API bug where clearing a vehicle attribute reported success but saved nothing: reproduced it, traced it to the data layer silently ignoring empty values, and fixed the check.
- Ended a production outage: an upgrade stopped the whole database; from the deployed system's logs he traced it to SQL files containing a byte order mark, and stripped it.
- Built a C# GPS geofence service detecting buses entering and leaving depots, so over-the-air updates go out only while a bus is parked.

## Micromouse (IEEE student branch, Aug 2024-present; team captain; C/C++, Raspberry Pi Pico)
- Captain for 3 seasons; wrote the flood fill and A* planner and the PID control loop that keeps the mouse driving straight.
- Placed 2nd of 15+ teams at MIT and won Best Design with a 38 s run.

## WorkIt (Aug 2026-present; class team of 5; Python, FastAPI, Next.js, PostgreSQL)
- Built the WorkIt front end from Figma frames and the FastAPI endpoints behind its job search.

## Skills
- Languages: Python, C++, C#, Java, SQL, TypeScript.
