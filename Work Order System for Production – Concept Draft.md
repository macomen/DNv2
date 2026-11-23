# Work Order System for Production – Concept Draft

## 1. Purpose, scope and systems

The goal is one system that follows a work order from planning to classification. Today there is no system: orders are planned on paper or by word of mouth. This document is a concept on paper only. The implementation is done later and separately.

**Phase one** covers the shaping machine: work orders, planning on a machine timeline, needle tracking, DOB measurements, closing orders with the MFG/PRO label, our own label, and classification. **Phase two**, built on the same data, adds furnace planning. Hardening is parked for now (section 12).

### 1.1 Systems around it

- **MFG/PRO** is the official company system. All articles and the whole production are tied to it. Our system never writes into it and only reads what is on its label.
- **Article names** stay in the company system. In production every article is known by its manufacturing reference (a long number, for example 10256182) and its description (for example SX). Our system keeps the reference as the link and a copy of the description, so it can be shown on screens and on the label.
- **Existing hardening program:** the operator selects ident and furnace, and it shows the full process and parameters. It stays as it is. The only link needed is that it can read the article from the work order, so nobody types the ident twice.
- **Machine network:** a mesh network already connects the machines and a server, and a piece counter can be read at any time.
- **Our stack:** MariaDB on an Apache server, PHP backend, HTML, JavaScript and jQuery on the front end, phpMyAdmin for creating tables.

## 2. The production process

1. **Shaping.** A shaping machine makes internal teeth on forgings. It runs three needles (tools) at once, and each needle has its own work order. A needle has its own size and a fixed DOB range, and it can be used for several articles.
2. **Label.** When the quantity is made, the operator prints the official MFG/PRO label and scans it into our system. Our system prints its own label. Both labels travel with the pieces (section 11).
3. **Hardening.** Parts hang on rods and go into a furnace: furnaces 1 to 7, or larger furnaces at another location that take bigger batches. Ten pieces per rod and 170 rods give a batch of 1,700 pieces. Each article has its own furnace program, with shorter times for smaller parts, so articles are never mixed in one batch.
4. **Calibration and classification.** Every part is calibrated and sorted into one of seven classes by the state of its teeth (section 13).

Key relationship: the DOB measure after shaping predicts the result after hardening. Internal teeth shrink, and each furnace distorts them differently. Example: DOB 160 means the part must go into furnace 4 to land at 110 on the gauge and stay within specification.

Rods come in small, medium and large sizes, and rod size also influences the hardening result.

### 2.1 Why the process is unstable

- A worn needle (for example after 100,000 pieces) behaves differently from a new needle of the same size.
- Each batch of forgings, made in a different series, behaves slightly differently.
- Rod size and furnace affect the result too.

Consequence: a work order cannot be a fixed recipe. It is a plan that is corrected by real measurements, and the system should collect enough history to find patterns later.

## 3. Core rules

- One work order is one article and normally one needle. Articles are never mixed in one hardening batch.
- A needle can suit several articles, and an article can be made with several needles. The combination of article and needle decides the further processing.
- The DOB range belongs to the needle. Alternative needles should have the same or nearly the same range. Differences are allowed, but they are shown and logged.
- An article can have several standard quantities (for example 1,700 or 3,000). The planner picks one or types another number.
- Production runs at 130 pieces per hour per needle. A changeover takes 30 minutes and stops the whole machine, and only happens when the needle or article changes. Each shift ends with a 20 minute stop (section 8).
- After release an order is locked. Changes need a login and a reason, and go to a read-only history log.
- An order is closed by scanning its MFG/PRO labels, up to five per order. The pieces made are the sum of the labels.
- Classification is entered by hand in seven classes. The base is the pieces actually hardened, and only the planner or a higher role closes it.

## 4. Roles and login

Everyone logs in, and every action is tied to a named user. The system checks the role before every write.

| Role | Main tasks |
| --- | --- |
| Planner | Creates, releases and schedules orders. Changes released orders with a reason. Confirms schedule shifts and pieces hardened. Closes classification and cancels other people's classification entries. |
| Operator | No login of their own: the name comes from the MES system (section 9.5). Starts orders, confirms needle and position, enters DOB, swaps needles, scans MFG/PRO labels, prints labels, enters classification entries and cancels their own within the same shift. Closes an order by hand with a reason when needed. |
| Hardening worker | Takes over orders waiting for hardening. Details are parked (section 12). |
| Admin (higher role) | Maintains master data, settings, quantity lists and users. Has everything the planner has. |

Who may see reports is still open.

## 5. Master data

Master data changes rarely. Records are never deleted, only set inactive, so old orders keep pointing to what they used.

### 5.1 Articles

- The ident is the manufacturing reference, the link to the company system, and must be copied exactly. The planner picks the article by this reference when planning. It is worth deciding which system owns the ident, and a small PHP job can add new articles automatically.
- Each article has a default rod size.
- Each article has a list of standard quantities, one row per quantity, for example 1,700 and 3,000. The list is not tied to a furnace group. Old quantities are marked inactive, never deleted.
- The description (for example SX) is kept next to the reference, only for display.

### 5.2 Needles

- Name (for example 6.2), size, status (available, in machine, in refurbishment, retired) and piece counters.
- The DOB minimum and maximum belong to the needle and apply to every article it runs. Example: needle 6.2 has a range from 100 to 120.
- There is already a needle database. It will be shared later, and this table adapted to it.

### 5.3 Article and needle link

One row per allowed pair. It tells the planner's form which needles to offer for an article.

### 5.4 Machines and settings

- A machine has a name, three needle positions, a rate in pieces per hour (130 for now, set per machine) and a changeover duration (30 minutes).
- Plant settings: shift start times (6:00, 14:00, 22:00), the shift stop (20 minutes), and the DOB difference above which an alternative needle is highlighted.
- Extra planned stops, such as maintenance, will be added later.

### 5.5 Furnaces and classes

- Furnaces 1 to 7 plus the larger furnaces at another location. They are optional on an order and used mainly in phase two.
- Seven classes, always shown in this order: red, green 1, green 2, yellow, purple 1, purple 2, purple 3.

## 6. Work order

The planner creates a work order in one step. It is then followed through the machine, hardening and classification.

### 6.1 Fields set by the planner

1. **Work order number:** automatic and incrementing, never reused.
2. **Article (ident).**
3. **Machine:** optional, can be assigned later when the order is placed on the timeline.
4. **Quantity:** picked from the article's list, or typed by hand. The system accepts any number.
5. **Primary needle:** only available needles that fit the article. Its DOB range is taken from the needle, not typed.
6. **Alternative needles:** up to three, for when the primary needle is not available. Each one shows how far its DOB range is from the primary. A difference above the set threshold is highlighted. Nothing is blocked, because there are not many needles, but accepting a larger difference is a conscious, logged choice.
7. **Rod size:** fixed to three values: small, medium or large. The planner decides each time.
8. **Forging batch number:** optional and left empty for now. It can be filled in later, for example by production when the order is picked up. Where the number comes from is decided later.
9. **Furnace:** optional and left empty for now. The quantity already points to the furnaces that fit.
10. **Priority:** normal (the default) or high. A high priority order needs a plan quickly. For now the mark shows only in the buffer, not on the timeline and not in the weekly list. The order detail shows it everywhere.
11. **Notes.**

### 6.2 Filled in during execution

- Needle actually used and its position, machine, start and end time.
- Piece counter readings, received automatically from the machine.
- DOB measurements (section 9).
- MFG/PRO labels and the pieces made, which is the sum of the labels (section 11). The planned quantity stays on the order too.
- Pieces hardened, furnace and hardening details (section 12).
- Classification entries (section 13).
- Comments.

### 6.3 Status flow

1. Planned
2. Released (locked)
3. In production
4. Waiting for hardening
5. In hardening
6. Classification open
7. Closed

Interrupted is a side status: the order was stopped before the full quantity and can be continued later (section 9.9). When it is continued, it goes back to in production.

An order can also be cancelled. Every status change stores who did it and when. This gives an audit trail and real lead times for later planning.

### 6.4 Locking and history

- When the planner releases an order it is locked. Planned fields can then be changed only by the planner or higher, with a reason.
- Every change is written to a read-only history log: who, which field, old value, new value, reason and time. The application's database user can insert into the log but never update or delete.
- An idea for later: after production has started, a change needs a second confirmation, since the operator may already be running on the old values.

## 7. Planner screen

The planner screen has a list of all orders, filtered by status, article, machine or needle, and a form for a new order. The form follows section 6.1. The planner picks the article, and the quantity dropdown fills with that article's quantities. The system then shows only the needles that fit the article and are available, with their remaining life in a panel beside the form. Alternatives show their DOB difference. On save the order gets its number and the status planned.

### 7.1 Page layout (decided)

The planner works on one single page, with everything on it. The page has three parts from top to bottom.

1. **Buffer and new order.** The planner can plan many orders ahead, for example 15 orders on Monday for the whole week. Orders that are planned but not yet placed on the timeline sit in a buffer. The buffer is only an order status (planned, without a schedule slot). Orders in the buffer never change when the timeline changes. A quick form creates a new order, and a detail panel shows the selected order.
2. **Timeline.** A visual indicator of the plan, not a control that other things depend on. It has a filter bar with the week, the machine filter and a switch between one machine and all machines. There are three machines with three needles each, so nine lanes in total. With the machine filter the planner sees one machine and its three lanes, or all nine lanes at the same time.
3. **Weekly overview below the timeline.** Production is planned weekly, so the planner scrolls down to a list of the week's orders in three groups: running now at the top (where are we now), finished, and still planned. Each row shows article, needle, machine, quantity and status. Clicking a row highlights its bar on the timeline.

**Timeline colours:** grey for planned, blue for running, green for finished, and a red vertical line for the current time. The timeline updates itself from the real production state. A simple way is for jQuery to ask the server every 30 seconds or so.

Production is a living thing and changes from minute to minute, so the planner checks where production is and adjusts the plan when needed.

The mock-up below uses example values only.

&#91;embedded content: planner screen mock-up · new work order form and needle panel\]

## 8. Machine timeline

After creating an order the planner places it on the timeline of a machine. A machine has three lanes, one per needle position, and there are three machines, so nine lanes in total. The timeline shows when each order runs and when it ends.

&#91;embedded content: machine timeline · three lanes, shared 30 minute changeover\]

### 8.1 Rules

- **Rate:** 130 pieces per hour per needle, the same for every article and needle (push-pull system). It is a machine setting, not fixed in the code.
- **Duration:** quantity divided by the rate. 1,700 pieces take about 13 hours and 5 minutes of production.
- **Changeover:** 30 minutes, covering the needle exchange and the machine setup. The whole machine stops, so a changeover on one lane adds a 30 minute stop on all three lanes of that machine, and orders on the other two lanes of that machine are pushed back by 30 minutes. The three machines do not affect each other. This is a working assumption to confirm.
- **When it happens:** only when the next order on a lane has a different needle or article than the one before. Same needle and same article run straight on, so three identical orders in a row are one stretch. Rod size never causes a changeover.
- **Shift stops:** three shifts of 8 hours start at 6:00, 14:00 and 22:00. At the end of each shift there is a planned stop of 20 minutes, for example 13:40 to 14:00, with no production on any lane. This position is an assumption to confirm.
- **Around the clock:** the plan runs 24 hours a day. Only stops and changeovers interrupt production.
- **Same article on several lanes** is allowed and used in practice, each as its own order with its own needle.
- **Simultaneous changeovers:** if two lanes need one at the same moment, they share the same 30 minutes. This is a working assumption, since two needle swaps at once may take longer in reality.
- **Maintenance stops** can be added later as blocks across all lanes.

### 8.2 How the planner works with it

1. The new order appears in a list of unplanned orders next to the timeline.
2. The planner drags it onto a lane at a start time, or behind the previous order.
3. The system calculates the end time, and inserts a changeover across all lanes if needle or article differs from the previous order on that lane.
4. The planner places the next order right behind it.
5. Moving or removing an order recalculates everything after it.

### 8.3 Live view and late orders

When the operator starts an order, the counter starts and the timeline shows a marker for the current time and the actual progress, so the planner sees planned against actual. If an order falls behind, the following orders are only shown as late. The system proposes a new plan and the planner confirms the shift with one click. The confirmation is written to the history log.

### 8.4 Calculation in PHP (idea)

1. Load all slots of the machine, ordered by start.
2. Walk each lane in order and compare article and needle with the previous order on that lane.
3. If they differ, add a 30 minute changeover and shift all slots on the other lanes that start at or after that time.
4. Calculate the end by producing at the machine's rate and skipping every stop: shift stops, changeovers and maintenance. If a run crosses one shift stop, the end moves out by 20 minutes, and by 40 minutes if it crosses two.
5. Save everything in one database transaction, so a half-calculated plan is never stored.

Front end: jQuery UI draggable and droppable for moving the bars, positioned divs for the timeline, and PHP returning the plan as JSON.

## 9. Production at the machine

### 9.1 Operator screen

The operator works on a 24 inch touch screen. A screen is not tied to one machine, so the operator picks his machine on the screen and can switch between machines. The screen mirrors the machine: one large card per needle position. It shows only what the operator needs.

- **Top bar:** machine, shift, a big machine state (running or stopped) and the next planned stop.
- **Card per position:** order number, article, needle, piece count against the target with a progress bar, time left, the last DOB value with the needle's range, and when the next DOB is due. The piece count comes from the machine. Only the piece count is shown, with no DOB history.
- **Colour as signal:** the DOB badge is green in range, amber when a measurement is due and red when out of range.
- **Five buttons on every card:** Enter DOB, Swap needle, Finish (label scan), Interrupt and Print label, plus a Show work order button that opens a pop-up window with the full work order. Each belongs to that one position, so there is no choosing which needle an action is for, and they are big enough for gloved hands.
- **Next up:** the next planned orders on this machine, and whether a changeover will stop all lanes.
- **Needle life:** pieces since the last refurbishment, on the card.
- No extra functions for now, such as stop reporting.

The mock-up still shows a Finish order button. In the final design that button starts the label scan (section 11).

&#91;embedded content: operator screen mock-up · one card per needle position\]

### 9.2 Flows

1. **Start an order:** tap an empty card, which fixes the position, and choose an order from the list (section 9.6). Then confirm the needle (section 9.7). The counter then starts by itself.
2. **Enter DOB:** type the value on a number pad. The system adds time, needle and operator. A value outside the needle's range turns the card red and asks for a comment. For a manually entered needle there is no range and no check.
3. **Swap needle:** choose the new needle. The old usage closes and a new one opens, and the next DOB is checked against the new needle's range.
4. **Finish order:** scan the MFG/PRO label (section 11).

### 9.3 DOB measurements

- The operator is expected to enter a DOB every hour, so an order has 30 to 40 measurements. The first one is expected one hour after the order starts, not at the start, because the changeover already keeps the operator busy. Each measurement restarts the one hour countdown. If an hour passes without a value, the card changes colour (amber) to show it is overdue. The operator may enter more than one per hour. Each measurement is one single value, stored as its own record.
- Each one stores time, value, needle in use, machine, operator and an optional comment.
- Values outside the range of the needle actually in use are flagged at once, but this is only a record: the value is stored and shown on the card, and nothing else happens automatically (no sound, no message to the planner). If a value falls far out of tolerance, the operator reacts himself, by swapping the needle or by interrupting the order (section 9.9). Alternative needles have nearly the same range, but the check always follows the needle that is really running.
- Useful views: the trend over the run, and the average, minimum and maximum per order.
- Measurements are the main correction signal in an unstable process, so entering one must take only a few taps.

### 9.5 Who is working (MES)

- **No login in our app for production.** The operator already clocks in at the MES system when he arrives for work.
- Our app sends a GET request to MES and gets back the employee number and the full name. The employee number is the main identifier, and the name is for display.
- Every change in the app is recorded with the employee number and the name as it was at the time, so old records stay readable even if a name changes in MES.
- **If nobody is clocked in, or MES is not reachable,** the app shows a message and blocks every change. The screen can still show information, but all buttons that write anything stay disabled. If this turns out to be a problem during an outage, a break-glass option can be added later.
- Open: what the app sends to MES to find out who is clocked in at that screen (the workstation, the machine, or a number typed once).

### 9.6 Which orders the operator sees

- By default only the orders on the timeline for the machine he has open, one after the other in the order the planner set.
- A **Show all** button also shows everything on the plan, including buffer orders that have no slot on the timeline.
- The operator may start an order that is not first in line, but the system shows a warning first and he confirms it. The warning and the confirmation are logged.
- A buffer order has no machine and no position. When the operator starts one, the empty card he taps fixes the position. The order is recorded with that machine and position, the start is logged with an out-of-plan warning, and the planner sees it on the timeline afterwards.

### 9.7 Which needle is used

1. **By default the primary needle.** The operator confirms it on his screen.
2. **If the primary is not available,** he picks one of the alternatives the planner added, up to three.
3. **As a last resort,** he picks any needle from the full list of needles. The system shows the DOB difference from the primary, requires a comment, and marks the order so the planner sees later that the needle was chosen outside the plan.
4. **If the needle is not in the list at all,** he types it in by hand as a manual needle. It has no DOB range, so measurements for it are not checked. Every such measurement is flagged as manual needle, unchecked, the order is marked, and a comment is required.

The usage row for a manual needle stores the needle name as text and a flag that it was entered manually, instead of a link to the needles table.

### 9.8 Needle swap during an order

The pieces already made stay credited to the old needle. The old usage closes, a new one opens, and counts from then on go to the new needle. The next DOB is checked against the range of the new needle, unless it is a manual needle.

### 9.9 Interrupting an order

- **Why:** production is a living thing. If a DOB drops drastically out of tolerance, the operator may have to swap the needle or stop the order altogether.
- The operator can **interrupt** an order before the full quantity is made. It stays on the timeline marked as not finished, and it is the same order, with the status interrupted.
- The pieces made so far stay counted. Later the operator continues the same order. The status goes back to in production, and the counter picks up from where it left off. The remainder is not a new order.
- **Our own label can be printed at the interruption,** the same label as at the end (section 11.4), so there is traceability even for a partial batch. It shows the pieces made so far and is clearly marked as partial, so nobody mistakes it for a finished batch.
- A partial quantity can sometimes go to hardening before the order is complete. See section 12.

### 9.4 Machine counter

- The machine reports piece counts per needle position. The operator knows which needle sits in which position and confirms it when starting an order.
- Counts are stored as timestamped readings, not only a running total, so a restart or reset loses nothing. The position assignment is logged with a time, so counts are never credited to the wrong needle after a swap.
- The operator enters only what the machine cannot know: DOB, needle confirmation and comments.

## 10. Needle tracking

- **Life cycle:** a brand new needle runs about 10,000 pieces before its first refurbishment, then about 5,000 pieces between later ones. Total life is about 80,000 to 100,000 pieces, then the needle is retired.
- **Record:** name, size, DOB range, which articles it fits, status, pieces since the last refurbishment, total pieces, number of refurbishments and history of use.
- **Automatic counting:** piece counts from the machine feed the needle's counters, so nobody counts by hand.
- **Warnings:** the system warns when a needle nears refurbishment or retirement, and the planner only sees available needles.
- **Needle age** at the time of the order is stored on the order, because worn and new needles of the same size give different hardening results.
- The old needle program had a sound design but too many clicks and no automatic data capture. The new one must avoid exactly that.

## 11. Finishing an order

MFG/PRO is the official system. When the quantity is made, the worker prints its official label there. Our system reads that label as proof of what was produced.

### 11.1 Flow

1. The worker makes the planned quantity, for example 3,000 pieces. Normally this is one label, but there can be several, for example three labels of 1,000 pieces. There are never more than five.
2. The worker prints the official label or labels in MFG/PRO.
3. The worker scans each label barcode into our system.
4. A lookup module takes the label number and reads the label data directly from the MFG/PRO tables with a read-only user: quantity, ident and what is needed to close the order.
5. Each scanned label adds its quantity to a running total shown against the order, for example 1,000 of 3,000. When the total reaches the order quantity, the order closes and the status becomes waiting for hardening. All label numbers are saved on the order.
6. Our system prints its own label. The MFG/PRO labels and ours go together to hardening.

### 11.2 Checks

- **Wrong article:** blocked, with an explanation on the screen.
- **Different quantity:** allowed, with a clear warning showing both numbers and a comment from the operator.
- **Pieces made:** the sum of all scanned labels. The planned quantity stays on the order.
- **Same label twice:** a label can belong to one order and be scanned once. A second scan is refused.
- **Manual close:** the worker can close an order by hand with a reason, for example when a label cannot be scanned or when the labels add up to less than the quantity. The history log records it. An order that is only paused is interrupted, not closed (section 9.9), and can be continued.

### 11.3 Lookup module

One separate piece of code is the only place that talks to the label data. It takes a label number and returns quantity, ident and the other fields. If the source changes, only this module changes. It reads the MFG/PRO tables directly with a read-only database user, which already exists, and only the tables it needs. Our system only reads.

### 11.4 Our own label (A5)

It prints automatically after the scan, and the Print label button on the operator card can print it at any time, even before the first MFG/PRO label is scanned. Then the MFG/PRO barcode and the label list stay empty until a label is scanned; the order barcode works from the start. A reprint button counts reprints, so duplicates can be recognised. It shows everything:

- Order number, then the article as manufacturing reference plus description, large under the main barcode.
- Planned and actual quantity, and the MFG/PRO label number or numbers.
- Needle used and the planned alternatives.
- Rod size, and the furnace if one was set.
- DOB range and the last measured DOB.
- Forging batch if filled in, date, shift, operator and the planner's notes.
- **Two barcodes**, each with a caption. Ours is the main one: the work order number, printed large as the very first thing at the top of the label, and it opens the order when scanned. The other is smaller and sits lower on the label, away from ours, and is identical to the barcode of the first scanned MFG/PRO label, which is only the label number of about eight to ten digits.
- If there are several MFG/PRO labels, all their numbers and quantities are listed as text, but only the first one is a barcode.

The label printer is black and white, so the layout must not depend on colour: sections are separated by solid and dashed outlines and bold text only.

Both barcodes are Code 128, which is believed to be the type on the MFG/PRO label. This must be verified on a real label before building, because the copy has to be readable by the same scanner. The label is a plain HTML page with an A5 print stylesheet, and a small JavaScript library draws the barcodes.

&#91;embedded content: A5 label mock-up · order, needle, quantity, last DOB, barcode\]

## 12. Hardening (parked)

Hardening is parked for now, so phase one ends at the status waiting for hardening.

- The existing hardening program stays as it is and reads the article from the work order.
- The pieces actually hardened must be recorded per order, because classification is based on them. Until the hardening module exists, the classification screen starts from the planned quantity, and the planner or the hardening worker confirms or corrects it before classification opens.
- The furnace stays optional on the order. A `hardening_records` table is added in phase two: order, furnace, program, start, end and worker.
- Furnace planning in phase two sits on the same data: the seven furnaces plus the larger ones, many articles, and changeovers of about 30 minutes.
- **Partial batches:** a partial quantity of an interrupted order can go to hardening before the order is complete. The label printed at the interruption, with the partial quantity, is what travels with those pieces. Classification entries stay recorded against the order, and the screen shows hardened, classified and unclassified totals summed over all batches. The full solution, one record per hardening batch, belongs to the hardening phase.

## 13. Classification

Classification is the last step of an order. After hardening, every part is calibrated and sorted into a class by the state of its teeth. The system records how many pieces of each class an order produced, so the planner can judge the whole chain: needle, forging batch, furnace and calibration.

### 13.1 Rules

- **Manual entry** by an operator in the app. There is no automatic data from the calibration machines.
- **Seven classes**, always in this order: red (teeth too large), green 1 and green 2 (within tolerance), yellow (teeth too small), and purple 1, 2 and 3 (teeth far too small). The classes are stored in a table, so they can be added or renamed.
- **Several entries per order**, also over several shifts: select or scan the order, pick a class, type the pieces, and repeat. Each operator adds their own entries.
- **Base quantity:** the pieces actually hardened, not the planned quantity.
- **Progress:** the screen shows hardened, classified and unclassified pieces, for example 1,700, 800 and 900.
- **No overshoot:** an entry that would push the classified total above the pieces hardened is refused.
- **Corrections:** a wrong entry is cancelled with a reason, never deleted, and stays visible in the history. An operator can cancel only their own entries within the same shift. Older entries, or entries made by someone else, can be cancelled only by the planner or a higher role.
- **Closing:** only the planner or a higher role closes the classification of an order, because they evaluate the results. It may be closed with pieces still unclassified, for example lost or scrapped ones, with a reason. The status becomes closed, with who and when logged.

### 13.2 Screen

The operator scans the barcode of our A5 label or picks the order by hand. The scanner works like a keyboard: a scan types the order number into the order field, and the list filters down to that order.

&#91;embedded content: classification screen mock-up · progress, seven classes, entries\]

- A progress block with hardened, classified and unclassified pieces, and a bar.
- Seven large class buttons, each with its running total.
- A number pad for the pieces, and an entries list with class, pieces, operator and time.
- A Close button, shown only to the planner or higher, with a warning if pieces are still unclassified.

## 14. Reports and analysis

- Share of each class per order. Green 1 and green 2 are shown separately and also as one combined green total.
- Green share per needle, needle age, forging batch, furnace and rod size.
- Planned against actual quantity, and planned against actual time.
- Idea for phase three: with enough history, suggest which furnace to use for a given DOB, based on needle age, forging batch, rod size and green share. This is why needle age and forging batch number are stored from day one.

## 15. Database design (MariaDB, PHP, jQuery)

This is the one data model of the concept. It replaces the earlier rough versions.

### 15.1 Principles

- **Engine:** MariaDB is the database, InnoDB is the storage engine of each table. Choose InnoDB in phpMyAdmin (it is the default on current MariaDB), because only InnoDB gives foreign keys and transactions.
- **Character set:** utf8mb4 with collation utf8mb4\_unicode\_ci on every table, so special characters in names and comments work.
- **Master data versus transactions:** master data changes rarely. Transaction data (orders, readings, measurements, scans, log) grows daily. Keep them in separate tables.
- **Never delete master records.** Use an `active` flag, so old orders still point to needles, articles or quantities that are no longer in use.
- **Time:** DATETIME columns, always in one time zone, set in PHP as well.
- **Primary keys:** an `id` INT UNSIGNED AUTO\_INCREMENT on every table. The work order number is the primary key of `work_orders`, so it increments by itself.
- **Security in PHP:** PDO with prepared statements for every query, `password_hash` and `password_verify` for passwords, a session check on every request, and a role check before every write.
- **Transactions:** a change with its log entry, a needle swap, a label scan and a schedule recalculation each run inside one database transaction, so either everything is saved or nothing.

### 15.2 Master data tables

| Table | Columns | Notes |
| --- | --- | --- |
| users | id, username (unique), password\_hash, full\_name, role (planner, operator, hardening, admin), active | Login and roles |
| articles | id, ident (manufacturing reference, unique), description, default\_rod\_size, active | The name stays in the company system |
| article\_quantities | id, article\_id, quantity, sort\_order, active | Several rows per article; unique on article plus quantity |
| needles | id, name (unique, for example 6.2), dob\_min, dob\_max, status (available, in\_machine, in\_refurbishment, retired), pieces\_since\_refurb, pieces\_total, refurb\_count, active | The DOB range lives here only |
| article\_needles | article\_id, needle\_id (both together form the primary key) | Which needle fits which article |
| machines | id, name (unique), positions (default 3), pieces\_per\_hour (default 130), changeover\_minutes (default 30), active | Per machine settings |
| furnaces | id, name, active | Furnaces 1 to 7 and the larger ones |
| classes | id, code (R, G1, G2, Y, P1, P2, P3), name, sort\_order, active | The seven classes |
| settings | name (unique), value | Shift start times, shift stop minutes, DOB difference threshold |
| planned\_stops | id, machine\_id, start, end, reason | Maintenance and other extra stops, later |

### 15.3 Work order and planning tables

| Table | Columns | Notes |
| --- | --- | --- |
| work\_orders | id (the order number), article\_id, quantity (planned), pieces\_made (nullable), pieces\_hardened (nullable), primary\_needle\_id, rod\_size (small, medium, large), priority (normal, high; default normal), machine\_id (nullable), furnace\_id (nullable), forging\_batch (nullable), status, locked (0 or 1), notes, created\_by, created\_at, released\_at, started\_at, finished\_at, closed\_manually (0 or 1), close\_reason, classification\_closed\_by, classification\_closed\_at, classification\_close\_reason | Central table; the quantity is copied onto the order, so changing the list never changes old orders |
| work\_order\_alternatives | id, work\_order\_id, needle\_id, priority (1 to 3), accepted\_reason (nullable) | One row per alternative; unique on order plus needle |
| schedule\_slots | id, work\_order\_id, machine\_id, position (1 to 3), planned\_start, planned\_end, sequence, slot\_type (order or changeover), triggered\_by\_slot\_id (nullable) | One row per planned order; a changeover is three rows, one per lane, with the same start and end |

### 15.4 Execution tables

| Table | Columns | Notes |
| --- | --- | --- |
| needle\_usage | id, work\_order\_id, needle\_id, machine\_id, position (1 to 3), started\_at, ended\_at (nullable), confirmed\_by | Which needle sat in which position and when; a swap closes one row and opens another |
| counter\_readings | id, work\_order\_id, needle\_usage\_id, reading\_time, count | Timestamped readings from the machine, never only a running total |
| dob\_measurements | id, work\_order\_id, needle\_id, measured\_at, value, operator\_id, comment | About one per hour, 30 to 40 per order |
| order\_labels | id, work\_order\_id, label\_number (unique across the whole system), quantity, scanned\_by, scanned\_at, position (1 to 5) | One row per scanned MFG/PRO label, up to five per order; position 1 is the one printed as a barcode on our label |
| label\_scans | id, work\_order\_id, label\_number, scanned\_by, scanned\_at, label\_quantity, label\_ident, result (ok, warning, blocked) | Every scan is kept, also refused ones |
| label\_prints | id, work\_order\_id, printed\_by, printed\_at, reprint\_number | Every print of our own label |

### 15.5 Classification and log tables

| Table | Columns | Notes |
| --- | --- | --- |
| classification\_entries | id, work\_order\_id, class\_id, pieces, entered\_by, entered\_at, cancelled (0 or 1), cancelled\_by, cancelled\_at, cancel\_reason | One row per entry; sums and percentages are calculated, never stored |
| status\_history | id, work\_order\_id, old\_status, new\_status, user\_id, changed\_at | Every status change |
| change\_log | id, work\_order\_id, user\_id, field\_name, old\_value, new\_value, reason, changed\_at | The read-only history log for edits after the order is locked |

Phase two adds `hardening_records`: work order, furnace, program, start, end and worker. Nothing above needs to change for it.

### 15.6 Keys, indexes and rules

- **Foreign keys:** every `_id` column that points to another table gets a foreign key (in phpMyAdmin, the Relation view of each table). Use ON DELETE RESTRICT everywhere, so nothing referenced can be deleted by accident.
- **Indexes:** work\_orders on status, article\_id and primary\_needle\_id; counter\_readings and dob\_measurements on work\_order\_id plus time; needle\_usage on needle\_id plus ended\_at; schedule\_slots on machine\_id plus planned\_start; order\_labels, classification\_entries and change\_log on work\_order\_id.
- **Unique rules:** one open usage row per machine position; the same needle cannot be an alternative twice on one order; alternative priority is unique per order; a label number is unique in the whole system; article plus quantity is unique in the quantities list; order plus label position (1 to 5) is unique, which also limits an order to five labels.
- **Read-only log:** create a dedicated MariaDB user for the application with SELECT and INSERT on `change_log`, `status_history`, `label_scans` and `label_prints`, but no UPDATE or DELETE. Even a bug in the PHP code cannot then change the history.
- **Locked orders:** when `locked` is 1, PHP refuses to change planned fields unless a reason is supplied. The change and its `change_log` row are written in one transaction.
- **Calculated values:** `pieces_made` is the sum of `order_labels`, and the needle counters are the sum of the counter readings. If the numbers ever disagree, the underlying rows are the truth and the totals can be rebuilt.

### 15.7 Typical flows in PHP

1. **Create order (planner):** check role, start a transaction, insert into `work_orders` with status planned, insert the alternatives and a `status_history` row, commit. The new id is the order number.
2. **Place on the timeline (planner):** recalculate the slots of the machine and save them in one transaction (section 8.4).
3. **Release (planner):** set `locked` to 1, `released_at` and the status, and write the history row.
4. **Start on machine (operator):** confirm needle and position, insert a `needle_usage` row, set the order to in production and the needle to in machine.
5. **Counter reading (machine, automatic):** an endpoint receives the count per position, finds the open `needle_usage` row for it, inserts a `counter_readings` row and updates the needle totals.
6. **DOB measurement (operator):** insert into `dob_measurements` with the needle in use, compare with that needle's `dob_min` and `dob_max`, and flag it if outside.
7. **Needle swap (operator):** in one transaction, close the open usage row, open a new one with the new needle and update both needle statuses.
8. **Scan an MFG/PRO label (operator):** call the lookup module, check article and quantity, insert into `order_labels` and `label_scans`, update `pieces_made`. When the total reaches the quantity, or the order is closed by hand with a reason, set the status to waiting for hardening, close the usage row, print our label and write `label_prints`.
9. **Confirm pieces hardened (planner or hardening worker):** set `pieces_hardened` and move the order to classification open.
10. **Classification entry (operator):** insert into `classification_entries`, refuse an entry that would exceed `pieces_hardened`. Cancelling follows the rules in section 13.1.
11. **Close classification (planner or higher):** set the closing fields and the status closed, with a history row.
12. **Change after lock (planner):** require a reason, update the field and write `change_log` in the same transaction.

## 16. Phases and build order

### 16.1 Phases

1. **Phase one:** articles and quantities, needles, work orders, the machine timeline, the operator screen, automatic piece counting, needle tracking, DOB measurements, MFG/PRO label scan with our own label, and classification.
2. **Phase two:** hardening and furnace planning on the same data (seven furnaces plus the larger ones, many articles, changeovers, sequencing to keep changeovers low).
3. **Phase three (idea):** analysis and suggestions, for example which furnace to recommend for a given DOB, based on the history.

### 16.2 Suggested build order

1. Create the database and the master data tables, then add test data for a few articles, quantities, needles and one machine.
2. Build login, sessions and roles.
3. Build the planner screen: create, list and release orders.
4. Build the machine timeline with changeover and shift stop logic.
5. Build the operator screen: start order, needle confirmation, DOB entry, needle swap.
6. Add the counter endpoint and connect one machine as a test.
7. Add the MFG/PRO lookup module, the label scan and our own label.
8. Add classification entry and the first report (green share per order).
9. Add the change log screen and the needle overview.
10. Leave hardening for phase two.

## 17. Open questions

### 17.1 Machine connection

- Does the machine call a PHP endpoint, or does a separate service read the counters and write them to the database?
- How does a machine identify itself and its needle position in the call, and how is the endpoint protected?
- How is a counter reset handled?
- Should old counter readings be archived after some months?

### 17.2 MFG/PRO and labels (decided)

- **Barcode type:** the MFG/PRO barcode is Code 128. It is worth one check on a real label before building, but the design assumes it.
- **Lookup:** we have access to the MFG/PRO tables, so the lookup module reads the label data directly from them. A read-only database user already exists, so our code cannot change anything in the official system. The module reads only the tables it needs.
- **Scanning in hardening:** the worker can scan either barcode. Scanning our barcode opens the work order. Scanning the MFG/PRO label also opens the same order, because the label number is stored on the order.
- **Printer:** the A5 label is printed on a normal office printer, which is already set up at the workstation. No special printer software is needed.
- **Mock-ups:** the operator screen and the A5 label mock-up are redrawn and match the rules above.

### 17.3 Planning

- Does the 20 minute shift stop sit at the end of the shift, for example 13:40 to 14:00?
- Do simultaneous changeovers really share the same 30 minutes?
- Should the planner be able to create several orders at once, for example one per needle for the same article?

### 17.4 Hardening and classification

- Who records the furnace and the hardening parameters, and does the existing hardening program need to write back?
- Should classification start from the pieces made (the label total) instead of the planned quantity?

### 17.5 Data and reports

- Where does the forging batch number come from, and how is it entered?
- How are rework batches (re-hardening, hard shaping) tracked later?
- Who may see reports?
- Is a separate table for needle refurbishment events needed, and how is the needles table adapted to the existing needle database?
