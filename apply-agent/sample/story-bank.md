# Story bank: Test Person

The sample applicant's stories, all invented. Essays are written only from what
is here: replace it with your own. Your own essays and answers go first, word
for word, so Claude can copy how you write; then one section per school, job
or project, one story per bullet, from Education to Skills.

## Test's own essays
My favorite project is the shelf scanner I built for our campus library. Students kept walking to shelves for books that were checked out, because the catalog only updated once a night. I wrote a small Flask app that reads the checkout log every five minutes, and then the catalog page shows a book as out within minutes. The librarians now send students to it first.

The hardest bug I have fixed was in our robot's drive code. The robot drifted left on every run, and we had blamed the motors for weeks. I logged both wheel encoders and saw that one read slower only when the battery dropped, so the speed loop was trusting a bad number. I added a check that compares the two encoders and then scales the weaker one back up. After that, the robot drove straight on a low battery too.

At my internship I learned that a fix nobody can see is not done. I had cut a slow report from four minutes to twenty seconds, but the operations team still ran it at night out of habit. So I added a line to the report saying when it last ran and how long it took. Within a week they were running it in the morning before their standup.

I like teaching what I just learned. When our robotics club got new members, I wrote a one-page guide to our code: where the drive loop lives, how to run the simulator, and which tests to run before a push. Two new members fixed real bugs in their first month, and they still point the next group to that page.

## Test's own answers, word for word
- Why this field: I chose computer science after our robot first drove itself across the gym. A few lines of code changed what a machine did, and I wanted to keep doing that.
- What I want from an internship: I want to ship code a team keeps using after I leave, and to learn how a big codebase is tested and reviewed.
- How I use AI tools: I use an assistant to explain code I have not read before and to draft tests, and then I run the tests myself before I trust anything it wrote.

## Education
- Illinois State University, B.S. Computer Science with a minor in Mathematics, expected May 2028. GPA 3.7/4.0.
- Coursework: Data Structures, Algorithms, Computer Systems, Databases.
- Applying for Summer 2027 software engineering internships.

## Example Logistics: Software Engineering Intern (Jun-Aug 2026, Springfield, IL; Python, PostgreSQL)
- Built a Python service that flags deliveries likely to be late from the morning's route data, so dispatchers call customers before the delivery window ends.
- Cut the weekly late-delivery report from about 4 minutes to about 20 seconds by moving its joins into one PostgreSQL query with an index on the route date.
- Added a "last run" line to the report, and the operations team moved it from nights to their morning standup.

## Illinois State University Library: Student Developer (Sep 2025-present; Flask, React)
- Built the shelf scanner: a Flask app that reads the checkout log every 5 minutes so the catalog shows a book as checked out within minutes, not the next day.
- Maintains the room booking web app; added email reminders that cut no-shows for study rooms.

## Robotics Club (Illinois State University, Aug 2024-present; software lead; C++)
- Fixed the robot's drift to the left: logged both wheel encoders, found one read slow on a low battery, and added a check that scales the weaker reading back up.
- Wrote a one-page guide to the club's code for new members; two of them fixed real bugs in their first month.
- Placed 3rd of 12 teams at the 2025 regional autonomous driving contest.

## Skills
- Languages: Python, Java, C++, SQL, JavaScript.
- Frameworks and tools: React, Flask, PostgreSQL, Git, Docker.
