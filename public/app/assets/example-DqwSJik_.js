var e=Object.assign({"../../../examples/travel-app/README.md":"# travel-app — an example Starboard project\n\nAn invented trip-planning app for iOS, Android and the web: 21 screens in six\nareas (`auth`, `home`, `trip`, `activity`, `sharing`, `settings`) and eight\nflows. It shows:\n\n- three platforms, each with `roots` and `screenFiles` for reverse coverage,\n  and `files` pointing at the empty placeholder sources under `src/`;\n- a `requires` vocabulary read from `capabilities.json`;\n- a proposed screen (`trip.packing`), a proposed region that leads to it\n  (`trip.checklist#packing`), and a per-platform status (`sharing.invite`\n  is shipped on iOS and the web and proposed on Android);\n- a screen on only some platforms, with its `platformNote`\n  (`settings.account`);\n- a `web-wide` override that turns `trip.timeline`'s tab bar into a `nav`\n  sidebar inside a `row`, with a map beside it;\n- flows with a goal, a Mermaid diagram, numbered steps whose every item\n  names a screen or region, branches and platform adaptations. Among them is\n  `add-activity`, a five-step flow.\n\nThe web app opens it from **Explore the example project**, bundled at build\ntime. It is kept clean under `starboard lint --strict`, which `make\nexamples-check` (part of `make ci`) checks:\n\n```sh\ngo build -o bin/starboard ./cmd/starboard\nbin/starboard --dir examples/travel-app lint --strict\n```\n\nAfter changing `screens.yaml` or a flow, run `starboard fmt` and\n`starboard generate` here so the generated pages stay current.\n","../../../examples/travel-app/capabilities.json":`{
  "about": "What a traveller may do on a trip. screens.yaml's requires fields must name one of these.",
  "capabilities": [
    { "name": "viewTrip", "about": "See the trip's days, places and people." },
    { "name": "editLogistics", "about": "Add, change and remove activities and tasks." },
    { "name": "answerInvitations", "about": "Say whether you are going to an activity." },
    { "name": "manageMembers", "about": "Invite people and change what they may do." },
    { "name": "editPacking", "about": "Add to and tick off the packing list." }
  ]
}
`,"../../../examples/travel-app/docs/flows/flows/add-activity.md":`---
id: add-activity
title: Add an activity
status: shipped
actors: [traveller]
entry: trip.timeline
---

**Goal:** put something on one day of the trip, at a place.

\`\`\`mermaid
flowchart TD
  timeline["@trip.timeline"] -->|"@trip.timeline#add-activity"| add["@activity.add"]
  add -->|"@activity.add#place"| search["@activity.place-search"]
  search --> add
  add -->|"@activity.add#save"| timeline
\`\`\`

## Steps

1. Tap @trip.timeline#add-activity.
   - If the traveller cannot edit logistics, the button is hidden.
2. Name it in @activity.add#title.
3. Choose the day in @activity.add#day.
4. Pick a place in @activity.place-search#results.
5. Tap @activity.add#save; the activity appears on @trip.timeline#days.
`,"../../../examples/travel-app/docs/flows/flows/answer-the-inbox.md":`---
id: answer-the-inbox
title: Answer the inbox
status: shipped
actors: [traveller]
entry: trip.timeline
---

**Goal:** say whether you are going to the activities you were invited to,
and bring someone else along.

\`\`\`mermaid
flowchart TD
  timeline["@trip.timeline"] -->|"@trip.timeline#tabs"| inbox["@trip.inbox"]
  inbox -->|"@trip.inbox#invitations"| detail["@activity.detail"]
  detail -->|"@activity.detail#invite"| invite["@activity.invite"]
  invite -->|"@activity.invite#send"| detail
\`\`\`

## Steps

1. Open @trip.inbox from @trip.timeline#tabs.
2. Tap an invitation in @trip.inbox#invitations to open @activity.detail.
3. Answer in @activity.detail#answer; the invitation leaves the inbox.
4. To bring someone along, tap @activity.detail#invite.
5. Pick travellers in @activity.invite#travellers and tap
   @activity.invite#send; they show in @activity.detail#going as invited.
`,"../../../examples/travel-app/docs/flows/flows/invite-a-traveller.md":`---
id: invite-a-traveller
title: Invite a traveller
status: proposed
actors: [organizer]
entry: trip.info
---

**Goal:** bring someone onto the trip by email, with the role they need.

\`\`\`mermaid
flowchart TD
  info["@trip.info"] -->|"@trip.info#people"| roster["@sharing.roster"]
  roster -->|"@sharing.roster#invite"| invite["@sharing.invite"]
  invite -->|"@sharing.invite#send"| roster
\`\`\`

## Steps

1. Tap @trip.info#people to open @sharing.roster.
2. Tap @sharing.roster#invite.
   - Without the manageMembers capability, the button is hidden.
3. Type their address in @sharing.invite#email.
4. Choose what they may do in @sharing.invite#role.
5. Tap @sharing.invite#send; they appear in @sharing.roster#people as
   invited.

## Platform adaptations

- **android:** @sharing.invite is proposed; until it ships, organizers on
  Android share the join code from @trip.info#join-code instead.
`,"../../../examples/travel-app/docs/flows/flows/join-a-trip.md":`---
id: join-a-trip
title: Join a trip
status: shipped
actors: [traveller]
entry: home.trips
---

**Goal:** join a trip someone else planned, with the code they shared.

\`\`\`mermaid
flowchart TD
  trips["@home.trips"] -->|"@home.trips#join"| join["@sharing.join"]
  join -->|"@sharing.join#join"| timeline["@trip.timeline"]
  join -->|"@sharing.join#cancel"| trips
  join --> wrong{"Code not found"}
  wrong --> join
\`\`\`

## Steps

1. Tap @home.trips#join.
2. Type the code in @sharing.join#code.
3. Tap @sharing.join#join.
   - If no trip has that code, @sharing.join stays open and says so.
4. The trip's @trip.timeline opens, and the trip is now in @home.trips#trips.
`,"../../../examples/travel-app/docs/flows/flows/look-around-a-trip.md":`---
id: look-around-a-trip
title: Look around a trip
status: shipped
actors: [traveller]
entry: home.trips
---

**Goal:** see what is planned, day by day and on the map, without changing
anything.

\`\`\`mermaid
flowchart TD
  trips["@home.trips"] -->|"@home.trips#trips"| timeline["@trip.timeline"]
  timeline -->|"@trip.timeline#day-heading"| day["@trip.day"]
  day -->|"@trip.day#activities"| detail["@activity.detail"]
  timeline -->|"@trip.timeline#tabs"| map["@trip.map"]
  timeline -->|"@trip.timeline#info"| info["@trip.info"]
\`\`\`

## Steps

1. Tap a trip in @home.trips#trips.
2. On @trip.timeline, tap @trip.timeline#day-heading to see the whole day on
   @trip.day.
3. Tap an activity in @trip.day#activities to open @activity.detail.
4. Back on the timeline, switch to @trip.map from @trip.timeline#tabs.
5. Tap @trip.timeline#info for the dates and places on @trip.info.
   - Once the trip is over, @trip.info#ended says so.

## Platform adaptations

- **web-wide:** the tabs are a sidebar, and @trip.timeline#day-map shows the
  day's places beside the timeline.
`,"../../../examples/travel-app/docs/flows/flows/pack-for-a-trip.md":`---
id: pack-for-a-trip
title: Pack for a trip
status: proposed
actors: [traveller]
entry: trip.checklist
---

**Goal:** agree who brings what, so nothing is packed twice or forgotten.

\`\`\`mermaid
flowchart TD
  timeline["@trip.timeline"] -->|"@trip.timeline#tabs"| checklist["@trip.checklist"]
  checklist -->|"@trip.checklist#packing"| packing["@trip.packing"]
\`\`\`

## Steps

1. Open @trip.checklist from @trip.timeline#tabs.
2. Tap @trip.checklist#packing.
3. Add what to bring with @trip.packing#add-item.
4. Each entry in @trip.packing#items says who packs it; tick it off once it
   is in a bag.
`,"../../../examples/travel-app/docs/flows/flows/plan-a-trip.md":`---
id: plan-a-trip
title: Plan a trip
status: shipped
actors: [organizer]
entry: home.trips
---

**Goal:** start a new trip and land on its timeline, ready for activities.

\`\`\`mermaid
flowchart TD
  trips["@home.trips"] -->|"@home.trips#new-trip"| new["@home.new-trip"]
  new -->|"@home.new-trip#create"| timeline["@trip.timeline"]
\`\`\`

## Steps

1. Tap @home.trips#new-trip.
2. Name the trip in @home.new-trip#name.
3. Choose the dates in @home.new-trip#dates and the place in
   @home.new-trip#where.
4. Tap @home.new-trip#create to open @trip.timeline, empty until the first
   activity is added.
`,"../../../examples/travel-app/docs/flows/flows/sign-in-and-out.md":`---
id: sign-in-and-out
title: Sign up, sign in and sign out
status: shipped
actors: [traveller]
entry: auth.welcome
---

**Goal:** get from a signed-out app to your trips, check the account, and
sign out again.

\`\`\`mermaid
flowchart TD
  welcome["@auth.welcome"] -->|"@auth.welcome#sign-up"| signup["@auth.sign-up"]
  welcome -->|"@auth.welcome#sign-in"| signin["@auth.sign-in"]
  signup -->|"@auth.sign-up#create"| trips["@home.trips"]
  signin -->|"@auth.sign-in#sign-in"| trips
  trips -->|"@home.trips#settings"| settings["@settings.main"]
  settings -->|"@settings.main#account"| account["@settings.account"]
  settings -->|"@settings.main#sign-out"| welcome
\`\`\`

## Steps

1. Tap @auth.welcome#sign-up, or @auth.welcome#sign-in with an account
   already.
2. To sign up, fill in @auth.sign-up#details and tap @auth.sign-up#create.
3. To sign in, fill in @auth.sign-in#credentials and tap
   @auth.sign-in#sign-in.
4. Either way @home.trips opens, empty until you plan or join a trip.
5. Tap @home.trips#settings to open @settings.main.
6. See your name and email on @settings.account, opened with
   @settings.main#account.
7. Back on @settings.main, tap @settings.main#sign-out to return to
   @auth.welcome.

## Platform adaptations

- **web:** there is no account screen; step 6 happens in
  @settings.main#profile.
`,"../../../examples/travel-app/docs/flows/generated/app-map.md":`<!-- Generated by starboard. Do not edit. -->

# App map

\`\`\`mermaid
flowchart LR
  subgraph area1["auth"]
    auth_sign__in["auth.sign-in"]
    auth_sign__up["auth.sign-up"]
    auth_welcome["auth.welcome"]
  end
  subgraph area2["home"]
    home_new__trip["home.new-trip"]
    home_trips["home.trips"]
  end
  subgraph area3["trip"]
    trip_checklist["trip.checklist"]
    trip_day["trip.day"]
    trip_inbox["trip.inbox"]
    trip_info["trip.info"]
    trip_map["trip.map"]
    trip_packing["trip.packing"]
    trip_timeline["trip.timeline"]
  end
  subgraph area4["activity"]
    activity_add["activity.add"]
    activity_detail["activity.detail"]
    activity_invite["activity.invite"]
    activity_place__search["activity.place-search"]
  end
  subgraph area5["sharing"]
    sharing_invite["sharing.invite"]
    sharing_join["sharing.join"]
    sharing_roster["sharing.roster"]
  end
  subgraph area6["settings"]
    settings_account["settings.account"]
    settings_main["settings.main"]
  end
  activity_add --> activity_place__search
  activity_add --> trip_timeline
  activity_detail --> activity_add
  activity_detail --> activity_invite
  activity_invite --> activity_detail
  activity_place__search --> activity_add
  auth_sign__in --> auth_sign__up
  auth_sign__in --> home_trips
  auth_sign__up --> auth_sign__in
  auth_sign__up --> home_trips
  auth_welcome --> auth_sign__in
  auth_welcome --> auth_sign__up
  home_new__trip --> trip_timeline
  home_trips --> home_new__trip
  home_trips --> settings_main
  home_trips --> sharing_join
  home_trips --> trip_timeline
  settings_account --> auth_welcome
  settings_main --> auth_welcome
  settings_main --> settings_account
  sharing_invite --> sharing_roster
  sharing_join --> home_trips
  sharing_join --> trip_timeline
  sharing_roster --> sharing_invite
  trip_checklist --> trip_checklist
  trip_checklist --> trip_inbox
  trip_checklist --> trip_map
  trip_checklist --> trip_packing
  trip_checklist --> trip_timeline
  trip_day --> activity_add
  trip_day --> activity_detail
  trip_inbox --> activity_detail
  trip_inbox --> trip_checklist
  trip_inbox --> trip_inbox
  trip_inbox --> trip_map
  trip_inbox --> trip_timeline
  trip_info --> sharing_roster
  trip_map --> trip_checklist
  trip_map --> trip_inbox
  trip_map --> trip_map
  trip_map --> trip_timeline
  trip_timeline --> activity_add
  trip_timeline --> activity_detail
  trip_timeline --> trip_checklist
  trip_timeline --> trip_day
  trip_timeline --> trip_inbox
  trip_timeline --> trip_info
  trip_timeline --> trip_map
  trip_timeline --> trip_timeline
\`\`\`
`,"../../../examples/travel-app/docs/flows/generated/screens.md":`<!-- Generated by starboard. Do not edit. -->

# Screens

## auth

### Sign in (\`auth.sign-in\`)

- Purpose: Sign in with an email address and a password.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![auth.sign-in on phone](wireframes/auth.sign-in.phone.svg)
![auth.sign-in on web-narrow](wireframes/auth.sign-in.web-narrow.svg)
![auth.sign-in on web-wide](wireframes/auth.sign-in.web-wide.svg)

Files:

- ios: [src/ios/Screens/Auth/SignInView.swift](../../../src/ios/Screens/Auth/SignInView.swift)
- android: [src/android/SignInScreen.kt](../../../src/android/SignInScreen.kt)
- web: [src/web/routes/sign-in/+page.svelte](../../../src/web/routes/sign-in/+page.svelte)

Screenshots: none.

Navigates to:

- \`auth.sign-up\`
- \`home.trips\`

Reached from:

- \`auth.sign-up\`
- \`auth.welcome\`

Used in flows:

- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)

### Create an account (\`auth.sign-up\`)

- Purpose: Create an account with a name, an email address and a password.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![auth.sign-up on phone](wireframes/auth.sign-up.phone.svg)
![auth.sign-up on web-narrow](wireframes/auth.sign-up.web-narrow.svg)
![auth.sign-up on web-wide](wireframes/auth.sign-up.web-wide.svg)

Files:

- ios: [src/ios/Screens/Auth/SignUpView.swift](../../../src/ios/Screens/Auth/SignUpView.swift)
- android: [src/android/SignUpScreen.kt](../../../src/android/SignUpScreen.kt)
- web: [src/web/routes/sign-up/+page.svelte](../../../src/web/routes/sign-up/+page.svelte)

Screenshots: none.

Navigates to:

- \`auth.sign-in\`
- \`home.trips\`

Reached from:

- \`auth.sign-in\`
- \`auth.welcome\`

Used in flows:

- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)

### Welcome (\`auth.welcome\`)

- Purpose: The first screen of a signed-out app; create an account or sign in.
- Presentation: root
- Status: shipped
- Platforms: ios, android, web

![auth.welcome on phone](wireframes/auth.welcome.phone.svg)
![auth.welcome on web-narrow](wireframes/auth.welcome.web-narrow.svg)
![auth.welcome on web-wide](wireframes/auth.welcome.web-wide.svg)

Files:

- ios: [src/ios/Screens/Auth/WelcomeView.swift](../../../src/ios/Screens/Auth/WelcomeView.swift)
- android: [src/android/WelcomeScreen.kt](../../../src/android/WelcomeScreen.kt)
- web: [src/web/routes/welcome/+page.svelte](../../../src/web/routes/welcome/+page.svelte)

Screenshots: none.

Navigates to:

- \`auth.sign-in\`
- \`auth.sign-up\`

Reached from:

- \`settings.account\`
- \`settings.main\`

Used in flows:

- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)

## home

### New trip (\`home.new-trip\`)

- Purpose: Name a trip and choose its dates.
- Presentation: sheet
- Status: shipped
- Platforms: ios, android, web

![home.new-trip on phone](wireframes/home.new-trip.phone.svg)
![home.new-trip on web-narrow](wireframes/home.new-trip.web-narrow.svg)
![home.new-trip on web-wide](wireframes/home.new-trip.web-wide.svg)

Files:

- ios: [src/ios/Screens/Home/NewTripView.swift](../../../src/ios/Screens/Home/NewTripView.swift)
- android: [src/android/NewTripScreen.kt](../../../src/android/NewTripScreen.kt)
- web: [src/web/components/NewTripSheet.svelte](../../../src/web/components/NewTripSheet.svelte)

Screenshots: none.

Navigates to:

- \`trip.timeline\`

Reached from:

- \`home.trips\`

Used in flows:

- [Plan a trip](../flows/plan-a-trip.md)

### Your trips (\`home.trips\`)

- Purpose: Every trip you plan or travel on, the next one first.
- Presentation: root
- Status: shipped
- Platforms: ios, android, web

![home.trips on phone](wireframes/home.trips.phone.svg)
![home.trips on web-narrow](wireframes/home.trips.web-narrow.svg)
![home.trips on web-wide](wireframes/home.trips.web-wide.svg)

Files:

- ios: [src/ios/Screens/Home/TripsView.swift](../../../src/ios/Screens/Home/TripsView.swift)
- android: [src/android/TripsScreen.kt](../../../src/android/TripsScreen.kt)
- web: [src/web/routes/+page.svelte](../../../src/web/routes/+page.svelte)

Screenshots: none.

Navigates to:

- \`home.new-trip\`
- \`settings.main\`
- \`sharing.join\`
- \`trip.timeline\`

Reached from:

- \`auth.sign-in\`
- \`auth.sign-up\`
- \`sharing.join\`

Used in flows:

- [Join a trip](../flows/join-a-trip.md)
- [Look around a trip](../flows/look-around-a-trip.md)
- [Plan a trip](../flows/plan-a-trip.md)
- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)

## trip

### Checklist (\`trip.checklist\`)

- Purpose: What has to be done before the trip, and who is doing it.
- Presentation: tab
- Status: shipped
- Platforms: ios, android, web

![trip.checklist on phone](wireframes/trip.checklist.phone.svg)
![trip.checklist on web-narrow](wireframes/trip.checklist.web-narrow.svg)
![trip.checklist on web-wide](wireframes/trip.checklist.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/ChecklistView.swift](../../../src/ios/Screens/Trip/ChecklistView.swift)
- android: [src/android/ChecklistScreen.kt](../../../src/android/ChecklistScreen.kt)
- web: [src/web/routes/trip/checklist/+page.svelte](../../../src/web/routes/trip/checklist/+page.svelte)

Screenshots: none.

Navigates to:

- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.packing\`
- \`trip.timeline\`

Reached from:

- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Used in flows:

- [Pack for a trip](../flows/pack-for-a-trip.md)

### Day (\`trip.day\`)

- Purpose: One day of the trip on its own, with its places on a map.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![trip.day on phone](wireframes/trip.day.phone.svg)
![trip.day on web-narrow](wireframes/trip.day.web-narrow.svg)
![trip.day on web-wide](wireframes/trip.day.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/DayView.swift](../../../src/ios/Screens/Trip/DayView.swift)
- android: [src/android/DayScreen.kt](../../../src/android/DayScreen.kt)
- web: [src/web/routes/trip/day/+page.svelte](../../../src/web/routes/trip/day/+page.svelte)

Screenshots: none.

Navigates to:

- \`activity.add\`
- \`activity.detail\`

Reached from:

- \`trip.timeline\`

Used in flows:

- [Look around a trip](../flows/look-around-a-trip.md)

### Inbox (\`trip.inbox\`)

- Purpose: The invitations to activities that you have not answered yet.
- Presentation: tab
- Status: shipped
- Platforms: ios, android, web

![trip.inbox on phone](wireframes/trip.inbox.phone.svg)
![trip.inbox on web-narrow](wireframes/trip.inbox.web-narrow.svg)
![trip.inbox on web-wide](wireframes/trip.inbox.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/InboxView.swift](../../../src/ios/Screens/Trip/InboxView.swift)
- android: [src/android/InboxScreen.kt](../../../src/android/InboxScreen.kt)
- web: [src/web/routes/trip/inbox/+page.svelte](../../../src/web/routes/trip/inbox/+page.svelte)

Screenshots: none.

Navigates to:

- \`activity.detail\`
- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Reached from:

- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Used in flows:

- [Answer the inbox](../flows/answer-the-inbox.md)

### Trip info (\`trip.info\`)

- Purpose: The trip's dates, places and people, and its join code.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![trip.info on phone](wireframes/trip.info.phone.svg)
![trip.info on web-narrow](wireframes/trip.info.web-narrow.svg)
![trip.info on web-wide](wireframes/trip.info.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/TripInfoView.swift](../../../src/ios/Screens/Trip/TripInfoView.swift)
- android: [src/android/TripInfoScreen.kt](../../../src/android/TripInfoScreen.kt)
- web: [src/web/routes/trip/info/+page.svelte](../../../src/web/routes/trip/info/+page.svelte)

Screenshots: none.

Navigates to:

- \`sharing.roster\`

Reached from:

- \`trip.timeline\`

Used in flows:

- [Invite a traveller](../flows/invite-a-traveller.md)
- [Look around a trip](../flows/look-around-a-trip.md)

### Trip map (\`trip.map\`)

- Purpose: Where each activity is, day by day.
- Presentation: tab
- Status: shipped
- Platforms: ios, android, web

![trip.map on phone](wireframes/trip.map.phone.svg)
![trip.map on web-narrow](wireframes/trip.map.web-narrow.svg)
![trip.map on web-wide](wireframes/trip.map.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/TripMapView.swift](../../../src/ios/Screens/Trip/TripMapView.swift)
- android: [src/android/TripMapScreen.kt](../../../src/android/TripMapScreen.kt)
- web: [src/web/routes/trip/map/+page.svelte](../../../src/web/routes/trip/map/+page.svelte)

Screenshots: none.

Navigates to:

- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Reached from:

- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Used in flows:

- [Look around a trip](../flows/look-around-a-trip.md)

### Packing list (\`trip.packing\`)

- Purpose: What to bring, and who brings each thing so nothing is packed twice.
- Presentation: push
- Status: proposed
- Platforms: ios, android, web

![trip.packing on phone](wireframes/trip.packing.phone.svg)
![trip.packing on web-narrow](wireframes/trip.packing.web-narrow.svg)
![trip.packing on web-wide](wireframes/trip.packing.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/PackingView.swift](../../../src/ios/Screens/Trip/PackingView.swift)
- android: [src/android/PackingScreen.kt](../../../src/android/PackingScreen.kt)
- web: [src/web/routes/trip/packing/+page.svelte](../../../src/web/routes/trip/packing/+page.svelte)

Screenshots: none.

Navigates to: none.

Reached from:

- \`trip.checklist\`

Used in flows:

- [Pack for a trip](../flows/pack-for-a-trip.md)

### Timeline (\`trip.timeline\`)

- Purpose: The trip's days in order, with what happens on each; the trip's first tab.
- Presentation: tab
- Status: shipped
- Platforms: ios, android, web

![trip.timeline on phone](wireframes/trip.timeline.phone.svg)
![trip.timeline on web-narrow](wireframes/trip.timeline.web-narrow.svg)
![trip.timeline on web-wide](wireframes/trip.timeline.web-wide.svg)

Files:

- ios: [src/ios/Screens/Trip/TimelineView.swift](../../../src/ios/Screens/Trip/TimelineView.swift)
- android: [src/android/TimelineScreen.kt](../../../src/android/TimelineScreen.kt)
- web: [src/web/routes/trip/timeline/+page.svelte](../../../src/web/routes/trip/timeline/+page.svelte)

Screenshots: none.

Navigates to:

- \`activity.add\`
- \`activity.detail\`
- \`trip.checklist\`
- \`trip.day\`
- \`trip.inbox\`
- \`trip.info\`
- \`trip.map\`
- \`trip.timeline\`

Reached from:

- \`activity.add\`
- \`home.new-trip\`
- \`home.trips\`
- \`sharing.join\`
- \`trip.checklist\`
- \`trip.inbox\`
- \`trip.map\`
- \`trip.timeline\`

Used in flows:

- [Add an activity](../flows/add-activity.md)
- [Answer the inbox](../flows/answer-the-inbox.md)
- [Join a trip](../flows/join-a-trip.md)
- [Look around a trip](../flows/look-around-a-trip.md)
- [Pack for a trip](../flows/pack-for-a-trip.md)
- [Plan a trip](../flows/plan-a-trip.md)

## activity

### Add activity (\`activity.add\`)

- Purpose: Put something on one day of the trip.
- Presentation: sheet
- Status: shipped
- Platforms: ios, android, web

![activity.add on phone](wireframes/activity.add.phone.svg)
![activity.add on web-narrow](wireframes/activity.add.web-narrow.svg)
![activity.add on web-wide](wireframes/activity.add.web-wide.svg)

Files:

- ios: [src/ios/Screens/Activity/ActivityEditorView.swift](../../../src/ios/Screens/Activity/ActivityEditorView.swift)
- android: [src/android/ActivityEditorScreen.kt](../../../src/android/ActivityEditorScreen.kt)
- web: [src/web/components/ActivityEditorSheet.svelte](../../../src/web/components/ActivityEditorSheet.svelte)

Screenshots: none.

Navigates to:

- \`activity.place-search\`
- \`trip.timeline\`

Reached from:

- \`activity.detail\`
- \`activity.place-search\`
- \`trip.day\`
- \`trip.timeline\`

Used in flows:

- [Add an activity](../flows/add-activity.md)

### Activity (\`activity.detail\`)

- Purpose: One activity's time, place, notes and who is going.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![activity.detail on phone](wireframes/activity.detail.phone.svg)
![activity.detail on web-narrow](wireframes/activity.detail.web-narrow.svg)
![activity.detail on web-wide](wireframes/activity.detail.web-wide.svg)

Files:

- ios: [src/ios/Screens/Activity/ActivityDetailView.swift](../../../src/ios/Screens/Activity/ActivityDetailView.swift)
- android: [src/android/ActivityDetailScreen.kt](../../../src/android/ActivityDetailScreen.kt)
- web: [src/web/routes/trip/activity/+page.svelte](../../../src/web/routes/trip/activity/+page.svelte)

Screenshots: none.

Navigates to:

- \`activity.add\`
- \`activity.invite\`

Reached from:

- \`activity.invite\`
- \`trip.day\`
- \`trip.inbox\`
- \`trip.timeline\`

Used in flows:

- [Answer the inbox](../flows/answer-the-inbox.md)
- [Look around a trip](../flows/look-around-a-trip.md)

### Invite to activity (\`activity.invite\`)

- Purpose: Ask travellers on the trip to come to one activity.
- Presentation: sheet
- Status: shipped
- Platforms: ios, android, web

![activity.invite on phone](wireframes/activity.invite.phone.svg)
![activity.invite on web-narrow](wireframes/activity.invite.web-narrow.svg)
![activity.invite on web-wide](wireframes/activity.invite.web-wide.svg)

Files:

- ios: [src/ios/Screens/Activity/ActivityInviteView.swift](../../../src/ios/Screens/Activity/ActivityInviteView.swift)
- android: [src/android/ActivityInviteScreen.kt](../../../src/android/ActivityInviteScreen.kt)
- web: [src/web/components/ActivityInviteSheet.svelte](../../../src/web/components/ActivityInviteSheet.svelte)

Screenshots: none.

Navigates to:

- \`activity.detail\`

Reached from:

- \`activity.detail\`

Used in flows:

- [Answer the inbox](../flows/answer-the-inbox.md)

### Find a place (\`activity.place-search\`)

- Purpose: Search for the place an activity happens.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![activity.place-search on phone](wireframes/activity.place-search.phone.svg)
![activity.place-search on web-narrow](wireframes/activity.place-search.web-narrow.svg)
![activity.place-search on web-wide](wireframes/activity.place-search.web-wide.svg)

Files:

- ios: [src/ios/Screens/Activity/PlaceSearchView.swift](../../../src/ios/Screens/Activity/PlaceSearchView.swift)
- android: [src/android/PlaceSearchScreen.kt](../../../src/android/PlaceSearchScreen.kt)
- web: [src/web/components/PlaceSearch.svelte](../../../src/web/components/PlaceSearch.svelte)

Screenshots: none.

Navigates to:

- \`activity.add\`

Reached from:

- \`activity.add\`

Used in flows:

- [Add an activity](../flows/add-activity.md)

## sharing

### Invite someone (\`sharing.invite\`)

- Purpose: Send an invitation to the trip by email.
- Presentation: sheet
- Status: ios: shipped, android: proposed, web: shipped
- Platforms: ios, android, web

![sharing.invite on phone](wireframes/sharing.invite.phone.svg)
![sharing.invite on web-narrow](wireframes/sharing.invite.web-narrow.svg)
![sharing.invite on web-wide](wireframes/sharing.invite.web-wide.svg)

Files:

- ios: [src/ios/Screens/Sharing/InviteView.swift](../../../src/ios/Screens/Sharing/InviteView.swift)
- android: [src/android/InviteScreen.kt](../../../src/android/InviteScreen.kt)
- web: [src/web/components/InviteSheet.svelte](../../../src/web/components/InviteSheet.svelte)

Screenshots: none.

Navigates to:

- \`sharing.roster\`

Reached from:

- \`sharing.roster\`

Used in flows:

- [Invite a traveller](../flows/invite-a-traveller.md)

### Join a trip (\`sharing.join\`)

- Purpose: Join a trip with the code its organizer shared.
- Presentation: dialog
- Status: shipped
- Platforms: ios, android, web

![sharing.join on phone](wireframes/sharing.join.phone.svg)
![sharing.join on web-narrow](wireframes/sharing.join.web-narrow.svg)
![sharing.join on web-wide](wireframes/sharing.join.web-wide.svg)

Files:

- ios: [src/ios/Screens/Sharing/JoinView.swift](../../../src/ios/Screens/Sharing/JoinView.swift)
- android: [src/android/JoinScreen.kt](../../../src/android/JoinScreen.kt)
- web: [src/web/components/JoinDialog.svelte](../../../src/web/components/JoinDialog.svelte)

Screenshots: none.

Navigates to:

- \`home.trips\`
- \`trip.timeline\`

Reached from:

- \`home.trips\`

Used in flows:

- [Join a trip](../flows/join-a-trip.md)

### People (\`sharing.roster\`)

- Purpose: Who is on the trip and what each person may do.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![sharing.roster on phone](wireframes/sharing.roster.phone.svg)
![sharing.roster on web-narrow](wireframes/sharing.roster.web-narrow.svg)
![sharing.roster on web-wide](wireframes/sharing.roster.web-wide.svg)

Files:

- ios: [src/ios/Screens/Sharing/RosterView.swift](../../../src/ios/Screens/Sharing/RosterView.swift)
- android: [src/android/RosterScreen.kt](../../../src/android/RosterScreen.kt)
- web: [src/web/routes/trip/people/+page.svelte](../../../src/web/routes/trip/people/+page.svelte)

Screenshots: none.

Navigates to:

- \`sharing.invite\`

Reached from:

- \`sharing.invite\`
- \`trip.info\`

Used in flows:

- [Invite a traveller](../flows/invite-a-traveller.md)

## settings

### Account (\`settings.account\`)

- Purpose: Change your name, email and password, or delete the account.
- Presentation: push
- Status: shipped
- Platforms: ios, android

![settings.account on phone](wireframes/settings.account.phone.svg)

Files:

- ios: [src/ios/Screens/Settings/AccountView.swift](../../../src/ios/Screens/Settings/AccountView.swift)
- android: [src/android/AccountScreen.kt](../../../src/android/AccountScreen.kt)

Screenshots: none.

Navigates to:

- \`auth.welcome\`

Reached from:

- \`settings.main\`

Used in flows:

- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)

### Settings (\`settings.main\`)

- Purpose: Your profile, how the app behaves, and signing out.
- Presentation: push
- Status: shipped
- Platforms: ios, android, web

![settings.main on phone](wireframes/settings.main.phone.svg)
![settings.main on web-narrow](wireframes/settings.main.web-narrow.svg)
![settings.main on web-wide](wireframes/settings.main.web-wide.svg)

Files:

- ios: [src/ios/Screens/Settings/SettingsView.swift](../../../src/ios/Screens/Settings/SettingsView.swift)
- android: [src/android/SettingsScreen.kt](../../../src/android/SettingsScreen.kt)
- web: [src/web/routes/settings/+page.svelte](../../../src/web/routes/settings/+page.svelte)

Screenshots: none.

Navigates to:

- \`auth.welcome\`
- \`settings.account\`

Reached from:

- \`home.trips\`

Used in flows:

- [Sign up, sign in and sign out](../flows/sign-in-and-out.md)
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.add.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Add activity — phone">
<title>Add activity — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="94" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="174" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="254" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="334" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="414" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="494" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="574" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="654" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="734" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="28" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="28" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="38" y="164.5" width="362" height="689.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="164.5" width="362" height="633.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="177.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">form</text>
<text class="name" x="394" y="174.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">form</text>
<rect class="region" x="42" y="180.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="206.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What</text>
<text class="name" x="390" y="190.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="42" y="232.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="258.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day</text>
<text class="name" x="390" y="242.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day</text>
<rect class="region" x="42" y="284.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="310.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time</text>
<text class="name" x="390" y="294.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">time</text>
<rect class="region" x="42" y="336.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="362.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="390" y="346.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">place</text>
<rect class="region" x="42" y="388.5" width="354" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="401.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">category</text>
<text class="name" x="390" y="398.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">category</text>
<rect class="item" x="46" y="404.5" width="110" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="54" y="418.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Food</text>
<rect class="item" x="164" y="404.5" width="110" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="172" y="418.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sight</text>
<rect class="item" x="282" y="404.5" width="110" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="290" y="418.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Travel</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Save</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">save</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.add.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Add activity — web-narrow">
<title>Add activity — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="158.5" width="374" height="701.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="158.5" width="374" height="645.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="171.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">form</text>
<text class="name" x="400" y="168.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">form</text>
<rect class="region" x="36" y="174.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="200.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What</text>
<text class="name" x="396" y="184.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="36" y="226.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="252.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day</text>
<text class="name" x="396" y="236.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day</text>
<rect class="region" x="36" y="278.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="304.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time</text>
<text class="name" x="396" y="288.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">time</text>
<rect class="region" x="36" y="330.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="356.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="396" y="340.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">place</text>
<rect class="region" x="36" y="382.5" width="366" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="395.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">category</text>
<text class="name" x="396" y="392.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">category</text>
<rect class="item" x="40" y="398.5" width="114" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="412.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Food</text>
<rect class="item" x="162" y="398.5" width="114" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="170" y="412.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sight</text>
<rect class="item" x="284" y="398.5" width="114" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="292" y="412.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Travel</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Save</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">save</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.add.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Add activity — web-wide">
<title>Add activity — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="808" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="1440" height="900" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="159" width="1440" height="765" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="167" width="1424" height="749"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="167" width="1424" height="693" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="180" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">form</text>
<text class="name" x="1450" y="177" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">form</text>
<rect class="region" x="36" y="183" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="209" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What</text>
<text class="name" x="1446" y="193" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="36" y="235" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="261" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day</text>
<text class="name" x="1446" y="245" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day</text>
<rect class="region" x="36" y="287" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="313" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time</text>
<text class="name" x="1446" y="297" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">time</text>
<rect class="region" x="36" y="339" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="365" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="1446" y="349" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">place</text>
<rect class="region" x="36" y="391" width="1416" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="404" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">category</text>
<text class="name" x="1446" y="401" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">category</text>
<rect class="item" x="40" y="407" width="464" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="421" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Food</text>
<rect class="item" x="512" y="407" width="464" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="520" y="421" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sight</text>
<rect class="item" x="984" y="407" width="464" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="992" y="421" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Travel</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Save</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">save</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.detail.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Activity — phone">
<title>Activity — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="62" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="86" width="362" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="102" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day and time</text>
<text class="name" x="394" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">when</text>
<rect class="region" x="38" y="118" width="362" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M38 118 L400 318 M400 118 L38 318" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="222" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="394" y="128" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="38" y="326" width="362" height="448" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="339" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">attendance</text>
<text class="name" x="394" y="336" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">attendance</text>
<rect class="region" x="42" y="342" width="354" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="358" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Who is going · who is invited</text>
<text class="name" x="390" y="352" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">going</text>
<rect class="region" x="42" y="374" width="354" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="398" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Going or not</text>
<text class="name" x="390" y="384" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answer</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M250 380 V378 A3 3 0 0 1 256 378 V380"/><rect x="249" y="380" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="351.5" y="384" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answerInvitations</text>
<rect class="region" x="42" y="422" width="354" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="446" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite</text>
<text class="name" x="390" y="432" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M271.5 428 V426 A3 3 0 0 1 277.5 426 V428"/><rect x="270.5" y="428" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="351.5" y="432" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="38" y="782" width="362" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="798" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notes</text>
<text class="name" x="394" y="792" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notes</text>
<rect class="region" x="38" y="814" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="838" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Edit</text>
<text class="name" x="394" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">edit</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M286 820 V818 A3 3 0 0 1 292 818 V820"/><rect x="285" y="820" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="366.5" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.detail.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Activity — web-narrow">
<title>Activity — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="374" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="96" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day and time</text>
<text class="name" x="400" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">when</text>
<rect class="region" x="32" y="112" width="374" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 112 L406 312 M406 112 L32 312" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="400" y="122" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="32" y="320" width="374" height="460" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="333" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">attendance</text>
<text class="name" x="400" y="330" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">attendance</text>
<rect class="region" x="36" y="336" width="366" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="352" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Who is going · who is invited</text>
<text class="name" x="396" y="346" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">going</text>
<rect class="region" x="36" y="368" width="366" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="392" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Going or not</text>
<text class="name" x="396" y="378" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answer</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M256 374 V372 A3 3 0 0 1 262 372 V374"/><rect x="255" y="374" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="357.5" y="378" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answerInvitations</text>
<rect class="region" x="36" y="416" width="366" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="440" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite</text>
<text class="name" x="396" y="426" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M277.5 422 V420 A3 3 0 0 1 283.5 420 V422"/><rect x="276.5" y="422" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="357.5" y="426" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="32" y="788" width="374" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="804" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notes</text>
<text class="name" x="400" y="798" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notes</text>
<rect class="region" x="32" y="820" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="844" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Edit</text>
<text class="name" x="400" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">edit</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M292 826 V824 A3 3 0 0 1 298 824 V826"/><rect x="291" y="826" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="372.5" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.detail.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Activity — web-wide">
<title>Activity — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="1424" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="96" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day and time</text>
<text class="name" x="1450" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">when</text>
<rect class="region" x="32" y="112" width="1424" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 112 L1456 312 M1456 112 L32 312" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<text class="name" x="1450" y="122" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="32" y="320" width="1424" height="516" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="333" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">attendance</text>
<text class="name" x="1450" y="330" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">attendance</text>
<rect class="region" x="36" y="336" width="1416" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="352" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Who is going · who is invited</text>
<text class="name" x="1446" y="346" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">going</text>
<rect class="region" x="36" y="368" width="1416" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="392" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Going or not</text>
<text class="name" x="1446" y="378" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answer</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1306 374 V372 A3 3 0 0 1 1312 372 V374"/><rect x="1305" y="374" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1407.5" y="378" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">answerInvitations</text>
<rect class="region" x="36" y="416" width="1416" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="440" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite</text>
<text class="name" x="1446" y="426" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1327.5 422 V420 A3 3 0 0 1 1333.5 420 V422"/><rect x="1326.5" y="422" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1407.5" y="426" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="32" y="844" width="1424" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="860" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notes</text>
<text class="name" x="1450" y="854" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notes</text>
<rect class="region" x="32" y="876" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="900" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Edit</text>
<text class="name" x="1450" y="886" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">edit</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1342 882 V880 A3 3 0 0 1 1348 880 V882"/><rect x="1341" y="882" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1422.5" y="886" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.invite.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Invite to activity — phone">
<title>Invite to activity — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="94" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="174" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="254" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="334" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="414" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="494" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="574" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="654" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="734" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="28" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="28" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="38" y="164.5" width="362" height="689.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="164.5" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="188.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name · day</text>
<text class="name" x="394" y="174.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activity</text>
<rect class="region" x="38" y="212.5" width="362" height="585.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="225.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">travellers</text>
<text class="name" x="394" y="222.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">travellers</text>
<rect class="region" x="42" y="228.5" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="268.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="42" y="308.5" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="348.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="42" y="388.5" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="428.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invitations</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.invite.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Invite to activity — web-narrow">
<title>Invite to activity — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="158.5" width="374" height="701.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="158.5" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="182.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name · day</text>
<text class="name" x="400" y="168.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activity</text>
<rect class="region" x="32" y="206.5" width="374" height="597.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="219.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">travellers</text>
<text class="name" x="400" y="216.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">travellers</text>
<rect class="region" x="36" y="222.5" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="262.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="36" y="302.5" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="342.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="36" y="382.5" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="422.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invitations</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.invite.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Invite to activity — web-wide">
<title>Invite to activity — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="808" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="1440" height="900" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="159" width="1440" height="765" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="167" width="1424" height="749"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="167" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="191" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity name · day</text>
<text class="name" x="1450" y="177" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activity</text>
<rect class="region" x="32" y="215" width="1424" height="645" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="228" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">travellers</text>
<text class="name" x="1450" y="225" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">travellers</text>
<rect class="region" x="36" y="231" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="271" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="36" y="311" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="351" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="36" y="391" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="431" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · invited already</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invitations</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.place-search.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Find a place — phone">
<title>Find a place — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="64" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Search places</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">search</text>
<rect class="region" x="38" y="90" width="362" height="764" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="103" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">results</text>
<text class="name" x="394" y="100" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">results</text>
<rect class="region" x="42" y="106" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="146" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="42" y="186" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="226" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="42" y="266" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="306" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.place-search.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Find a place — web-narrow">
<title>Find a place — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="58" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Search places</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">search</text>
<rect class="region" x="32" y="84" width="374" height="776" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="97" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">results</text>
<text class="name" x="400" y="94" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">results</text>
<rect class="region" x="36" y="100" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="140" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="36" y="180" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="220" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="36" y="260" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="300" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/activity.place-search.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Find a place — web-wide">
<title>Find a place — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="58" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Search places</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">search</text>
<rect class="region" x="32" y="84" width="1424" height="832" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="97" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">results</text>
<text class="name" x="1450" y="94" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">results</text>
<rect class="region" x="36" y="100" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="140" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="36" y="180" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="220" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
<rect class="region" x="36" y="260" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="300" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Place</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-in.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Sign in — phone">
<title>Sign in — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="664" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">credentials</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">credentials</text>
<rect class="region" x="42" y="54" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="80" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="390" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="42" y="106" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="132" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Password</text>
<text class="name" x="390" y="116" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">password</text>
<rect class="region" x="38" y="710" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="738" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign in</text>
<text class="name" x="394" y="720" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
<rect class="region" x="38" y="766" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="790" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Forgot password</text>
<text class="name" x="394" y="776" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">forgot</text>
<rect class="region" x="38" y="814" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="838" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account instead</text>
<text class="name" x="394" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-in.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Sign in — web-narrow">
<title>Sign in — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="676" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">credentials</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">credentials</text>
<rect class="region" x="36" y="48" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="74" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="396" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="36" y="100" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="126" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Password</text>
<text class="name" x="396" y="110" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">password</text>
<rect class="region" x="32" y="716" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="744" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign in</text>
<text class="name" x="400" y="726" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
<rect class="region" x="32" y="772" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="796" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Forgot password</text>
<text class="name" x="400" y="782" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">forgot</text>
<rect class="region" x="32" y="820" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="844" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account instead</text>
<text class="name" x="400" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-in.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Sign in — web-wide">
<title>Sign in — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="732" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">credentials</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">credentials</text>
<rect class="region" x="36" y="48" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="74" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="1446" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="36" y="100" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="126" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Password</text>
<text class="name" x="1446" y="110" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">password</text>
<rect class="region" x="32" y="772" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="800" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign in</text>
<text class="name" x="1450" y="782" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
<rect class="region" x="32" y="828" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="852" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Forgot password</text>
<text class="name" x="1450" y="838" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">forgot</text>
<rect class="region" x="32" y="876" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="900" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account instead</text>
<text class="name" x="1450" y="886" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-up.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Create an account — phone">
<title>Create an account — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="680" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="382" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email · password</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="38" y="726" width="362" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="742" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What signing up agrees to</text>
<text class="name" x="394" y="736" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">terms</text>
<rect class="region" x="38" y="758" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="786" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create account</text>
<text class="name" x="394" y="768" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
<rect class="region" x="38" y="814" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="838" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="394" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-up.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Create an account — web-narrow">
<title>Create an account — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="692" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="382" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email · password</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="32" y="732" width="374" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="748" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What signing up agrees to</text>
<text class="name" x="400" y="742" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">terms</text>
<rect class="region" x="32" y="764" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="792" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create account</text>
<text class="name" x="400" y="774" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
<rect class="region" x="32" y="820" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="844" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="400" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.sign-up.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Create an account — web-wide">
<title>Create an account — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="748" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="410" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email · password</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="32" y="788" width="1424" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="804" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">What signing up agrees to</text>
<text class="name" x="1450" y="798" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">terms</text>
<rect class="region" x="32" y="820" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="848" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create account</text>
<text class="name" x="1450" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
<rect class="region" x="32" y="876" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="900" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="1450" y="886" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.welcome.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Welcome — phone">
<title>Welcome — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="160" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M38 38 L400 198 M400 38 L38 198" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="122" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Illustration of a map and a suitcase</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">hero</text>
<rect class="region" x="38" y="206" width="362" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="222" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Plan trips with the people going</text>
<text class="name" x="394" y="216" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">pitch</text>
<rect class="region" x="38" y="238" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="266" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account</text>
<text class="name" x="394" y="248" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
<rect class="region" x="38" y="294" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="318" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="394" y="304" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.welcome.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Welcome — web-narrow">
<title>Welcome — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="160" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 32 L406 192 M406 32 L32 192" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="116" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Illustration of a map and a suitcase</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">hero</text>
<rect class="region" x="32" y="200" width="374" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Plan trips with the people going</text>
<text class="name" x="400" y="210" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">pitch</text>
<rect class="region" x="32" y="232" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="260" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account</text>
<text class="name" x="400" y="242" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
<rect class="region" x="32" y="288" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="312" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="400" y="298" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/auth.welcome.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Welcome — web-wide">
<title>Welcome — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="160" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 32 L1456 192 M1456 32 L32 192" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="116" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Illustration of a map and a suitcase</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">hero</text>
<rect class="region" x="32" y="200" width="1424" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Plan trips with the people going</text>
<text class="name" x="1450" y="210" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">pitch</text>
<rect class="region" x="32" y="232" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="260" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create an account</text>
<text class="name" x="1450" y="242" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-up</text>
<rect class="region" x="32" y="288" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="312" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">I have an account</text>
<text class="name" x="1450" y="298" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-in</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.new-trip.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="New trip — phone">
<title>New trip — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="94" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="174" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="254" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="334" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="414" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="494" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="574" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="654" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="734" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="28" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="28" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="38" y="164.5" width="362" height="689.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="164.5" width="362" height="633.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="177.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">details</text>
<text class="name" x="394" y="174.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="42" y="180.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="206.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="390" y="190.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="42" y="232.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="258.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates</text>
<text class="name" x="390" y="242.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">dates</text>
<rect class="region" x="42" y="284.5" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="310.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Where to</text>
<text class="name" x="390" y="294.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create trip</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.new-trip.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="New trip — web-narrow">
<title>New trip — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="158.5" width="374" height="701.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="158.5" width="374" height="645.5" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="171.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">details</text>
<text class="name" x="400" y="168.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="36" y="174.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="200.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="396" y="184.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="36" y="226.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="252.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates</text>
<text class="name" x="396" y="236.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">dates</text>
<rect class="region" x="36" y="278.5" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="304.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Where to</text>
<text class="name" x="396" y="288.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create trip</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.new-trip.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="New trip — web-wide">
<title>New trip — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="808" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="1440" height="900" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="159" width="1440" height="765" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="167" width="1424" height="749"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="167" width="1424" height="693" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="180" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">details</text>
<text class="name" x="1450" y="177" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="36" y="183" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="209" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="1446" y="193" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="36" y="235" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="261" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates</text>
<text class="name" x="1446" y="245" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">dates</text>
<rect class="region" x="36" y="287" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="313" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Where to</text>
<text class="name" x="1446" y="297" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">where</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Create trip</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">create</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.trips.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Your trips — phone">
<title>Your trips — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="region" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="42" y="54" width="173" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="72" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trips</text>
<text class="name" x="209" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="223" y="54" width="173" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="72" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Settings</text>
<text class="name" x="390" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">settings</text>
<defs><clipPath id="sb-clip"><rect x="38" y="94" width="362" height="760"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="94" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="126" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Offline · changes sync later</text>
<text class="name" x="394" y="104" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">offline</text>
<rect class="region" x="38" y="158" width="362" height="592" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="171" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">trips</text>
<text class="name" x="394" y="168" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">trips</text>
<rect class="region" x="42" y="174" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="214" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="42" y="254" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="294" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="42" y="334" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="374" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="38" y="758" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="782" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join with a code</text>
<text class="name" x="394" y="768" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">New trip</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">new-trip</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.trips.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Your trips — web-narrow">
<title>Your trips — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="region" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="36" y="48" width="179" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trips</text>
<text class="name" x="209" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="223" y="48" width="179" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Settings</text>
<text class="name" x="396" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">settings</text>
<defs><clipPath id="sb-clip"><rect x="32" y="88" width="374" height="772"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="88" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="120" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Offline · changes sync later</text>
<text class="name" x="400" y="98" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">offline</text>
<rect class="region" x="32" y="152" width="374" height="604" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="165" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">trips</text>
<text class="name" x="400" y="162" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">trips</text>
<rect class="region" x="36" y="168" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="208" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="36" y="248" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="288" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="36" y="328" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="368" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="32" y="764" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="788" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join with a code</text>
<text class="name" x="400" y="774" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">New trip</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">new-trip</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/home.trips.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Your trips — web-wide">
<title>Your trips — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="region" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="36" y="48" width="704" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trips</text>
<text class="name" x="734" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="748" y="48" width="704" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="756" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Settings</text>
<text class="name" x="1446" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">settings</text>
<defs><clipPath id="sb-clip"><rect x="32" y="88" width="1424" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="88" width="1424" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="120" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Offline · changes sync later</text>
<text class="name" x="1450" y="98" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">offline</text>
<rect class="region" x="32" y="152" width="1424" height="660" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="165" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">trips</text>
<text class="name" x="1450" y="162" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">trips</text>
<rect class="region" x="36" y="168" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="208" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="36" y="248" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="288" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="36" y="328" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="368" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip · dates · people</text>
<rect class="region" x="32" y="820" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="844" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join with a code</text>
<text class="name" x="1450" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">New trip</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">new-trip</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/settings.account.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Account — phone">
<title>Account — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="720" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">details</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">details</text>
<rect class="region" x="42" y="54" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="80" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name</text>
<text class="name" x="390" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="42" y="106" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="132" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="390" y="116" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="38" y="766" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="790" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Change password</text>
<text class="name" x="394" y="776" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">password</text>
<rect class="region" x="38" y="814" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="838" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Delete account</text>
<text class="name" x="394" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">delete</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/settings.main.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Settings — phone">
<title>Settings — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="380" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">profile</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">profile</text>
<rect class="region" x="42" y="54" width="354" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="70" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email</text>
<text class="name" x="390" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="42" y="86" width="354" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="110" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Account</text>
<text class="name" x="390" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">account</text>
<rect class="region" x="38" y="426" width="362" height="380" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="439" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">preferences</text>
<text class="name" x="394" y="436" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">preferences</text>
<rect class="region" x="42" y="442" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="468" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Units</text>
<text class="name" x="390" y="452" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">units</text>
<rect class="region" x="42" y="494" width="354" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="520" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notifications</text>
<text class="name" x="390" y="504" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notifications</text>
<rect class="region" x="38" y="814" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="838" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign out</text>
<text class="name" x="394" y="824" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-out</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/settings.main.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Settings — web-narrow">
<title>Settings — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="386" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">profile</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">profile</text>
<rect class="region" x="36" y="48" width="366" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="64" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email</text>
<text class="name" x="396" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="36" y="80" width="366" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="104" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Account</text>
<text class="name" x="396" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">account</text>
<rect class="region" x="32" y="426" width="374" height="386" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="439" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">preferences</text>
<text class="name" x="400" y="436" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">preferences</text>
<rect class="region" x="36" y="442" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="468" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Units</text>
<text class="name" x="396" y="452" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">units</text>
<rect class="region" x="36" y="494" width="366" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="520" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notifications</text>
<text class="name" x="396" y="504" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notifications</text>
<rect class="region" x="32" y="820" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="844" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign out</text>
<text class="name" x="400" y="830" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-out</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/settings.main.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Settings — web-wide">
<title>Settings — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="414" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">profile</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">profile</text>
<rect class="region" x="36" y="48" width="1416" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="64" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Name · email</text>
<text class="name" x="1446" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">name</text>
<rect class="region" x="36" y="80" width="1416" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="104" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Account</text>
<text class="name" x="1446" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">account</text>
<rect class="region" x="32" y="454" width="1424" height="414" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="467" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">preferences</text>
<text class="name" x="1450" y="464" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">preferences</text>
<rect class="region" x="36" y="470" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="496" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Units</text>
<text class="name" x="1446" y="480" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">units</text>
<rect class="region" x="36" y="522" width="1416" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="548" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Notifications</text>
<text class="name" x="1446" y="532" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">notifications</text>
<rect class="region" x="32" y="876" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="900" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Sign out</text>
<text class="name" x="1450" y="886" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">sign-out</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.invite.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Invite someone — phone">
<title>Invite someone — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="94" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="174" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="254" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="334" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="414" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="494" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="574" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="654" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="734" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="28" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="28" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="38" y="164.5" width="362" height="689.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="164.5" width="362" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="190.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="394" y="174.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="38" y="216.5" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="229.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">role</text>
<text class="name" x="394" y="226.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">role</text>
<rect class="item" x="42" y="232.5" width="112.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="246.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Organizer</text>
<rect class="item" x="162.5" y="232.5" width="112.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="170.5" y="246.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller</text>
<rect class="item" x="283.5" y="232.5" width="112.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="291.5" y="246.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Viewer</text>
<rect class="region" x="38" y="264.5" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="292.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invite</text>
<text class="name" x="394" y="274.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.invite.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Invite someone — web-narrow">
<title>Invite someone — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="150.5" width="390" height="717.5" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="158.5" width="374" height="701.5"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="158.5" width="374" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="184.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="400" y="168.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="32" y="210.5" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="223.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">role</text>
<text class="name" x="400" y="220.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">role</text>
<rect class="item" x="36" y="226.5" width="116.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="240.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Organizer</text>
<rect class="item" x="160.5" y="226.5" width="116.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="168.5" y="240.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller</text>
<rect class="item" x="285.5" y="226.5" width="116.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="293.5" y="240.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Viewer</text>
<rect class="region" x="32" y="258.5" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="286.5" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invite</text>
<text class="name" x="400" y="268.5" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.invite.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Invite someone — web-wide">
<title>Invite someone — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="808" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="1440" height="900" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="24" y="159" width="1440" height="765" rx="8" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="32" y="167" width="1424" height="749"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="167" width="1424" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="193" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Email address</text>
<text class="name" x="1450" y="177" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">email</text>
<rect class="region" x="32" y="219" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="232" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">role</text>
<text class="name" x="1450" y="229" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">role</text>
<rect class="item" x="36" y="235" width="466.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="249" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Organizer</text>
<rect class="item" x="510.5" y="235" width="466.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="518.5" y="249" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller</text>
<rect class="item" x="985.5" y="235" width="466.5" height="20" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="993.5" y="249" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Viewer</text>
<rect class="region" x="32" y="267" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="295" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Send invite</text>
<text class="name" x="1450" y="277" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">send</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.join.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Join a trip — phone">
<title>Join a trip — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="94" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="174" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="254" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="334" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="414" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="494" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="574" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="654" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="38" y="734" width="362" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="28" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="63" y="348" width="312" height="196" rx="12" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="71" y="356" width="296" height="180"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="71" y="356" width="296" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="372" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Type the code you were sent</text>
<text class="name" x="361" y="366" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">explain</text>
<rect class="region" x="71" y="388" width="296" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="414" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join code</text>
<text class="name" x="361" y="398" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">code</text>
<rect class="region" x="71" y="440" width="296" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="468" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join</text>
<text class="name" x="361" y="450" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="71" y="496" width="296" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="520" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Cancel</text>
<text class="name" x="361" y="506" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">cancel</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.join.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Join a trip — web-narrow">
<title>Join a trip — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="374" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="390" height="844" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="63" y="348" width="312" height="196" rx="12" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="71" y="356" width="296" height="180"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="71" y="356" width="296" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="372" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Type the code you were sent</text>
<text class="name" x="361" y="366" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">explain</text>
<rect class="region" x="71" y="388" width="296" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="414" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join code</text>
<text class="name" x="361" y="398" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">code</text>
<rect class="region" x="71" y="440" width="296" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="468" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join</text>
<text class="name" x="361" y="450" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="71" y="496" width="296" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="79" y="520" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Cancel</text>
<text class="name" x="361" y="506" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">cancel</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.join.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Join a trip — web-wide">
<title>Join a trip — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<rect class="parent" x="32" y="32" width="1424" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="88" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="168" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="248" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="328" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="408" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="488" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="568" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="648" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="728" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="parent" x="32" y="808" width="1424" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<rect class="scrim" x="24" y="24" width="1440" height="900" rx="8" fill="#808080" fill-opacity="0.4"/>
<rect class="panel" x="168" y="376" width="1152" height="196" rx="12" fill="#FFFFFF" stroke="#9A9A92" stroke-width="2"/>
<defs><clipPath id="sb-clip"><rect x="176" y="384" width="1136" height="180"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="176" y="384" width="1136" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="184" y="400" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Type the code you were sent</text>
<text class="name" x="1306" y="394" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">explain</text>
<rect class="region" x="176" y="416" width="1136" height="44" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="184" y="442" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join code</text>
<text class="name" x="1306" y="426" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">code</text>
<rect class="region" x="176" y="468" width="1136" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="184" y="496" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Join</text>
<text class="name" x="1306" y="478" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join</text>
<rect class="region" x="176" y="524" width="1136" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="184" y="548" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Cancel</text>
<text class="name" x="1306" y="534" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">cancel</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.roster.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="People — phone">
<title>People — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="760" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">people</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<rect class="region" x="42" y="54" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="94" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="42" y="134" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="174" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="42" y="214" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="254" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite someone</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M275.5 812 V810 A3 3 0 0 1 281.5 810 V812"/><rect x="274.5" y="812" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="355.5" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.roster.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="People — web-narrow">
<title>People — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="772" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">people</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<rect class="region" x="36" y="48" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="88" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="36" y="128" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="168" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="36" y="208" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="248" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite someone</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M281.5 818 V816 A3 3 0 0 1 287.5 816 V818"/><rect x="280.5" y="818" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="361.5" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/sharing.roster.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="People — web-wide">
<title>People — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="828" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">people</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<rect class="region" x="36" y="48" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="88" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="36" y="128" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="168" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="36" y="208" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="248" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Traveller · role</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Invite someone</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invite</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1331.5 874 V872 A3 3 0 0 1 1337.5 872 V874"/><rect x="1330.5" y="874" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1411.5" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.checklist.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Checklist — phone">
<title>Checklist — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="752"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="62" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="86" width="362" height="600" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="99" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tasks</text>
<text class="name" x="394" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tasks</text>
<rect class="region" x="42" y="102" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="142" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="42" y="182" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="222" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="42" y="262" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="302" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="38" y="694" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="722" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add a task</text>
<text class="name" x="394" y="704" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-task</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M264.5 700 V698 A3 3 0 0 1 270.5 698 V700"/><rect x="263.5" y="700" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="345" y="704" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="38" y="750" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1" stroke-dasharray="6 4"/>
<text class="label" x="46" y="774" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="394" y="760" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">packing</text>
</g>
<rect class="region" x="38" y="798" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="811" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="394" y="808" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="42" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="132.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="140.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="313.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="321.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.checklist.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Checklist — web-narrow">
<title>Checklist — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="764"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="374" height="612" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tasks</text>
<text class="name" x="400" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tasks</text>
<rect class="region" x="36" y="96" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="36" y="176" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="36" y="256" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="32" y="700" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="728" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add a task</text>
<text class="name" x="400" y="710" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-task</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M270.5 706 V704 A3 3 0 0 1 276.5 704 V706"/><rect x="269.5" y="706" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="351" y="710" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="32" y="756" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1" stroke-dasharray="6 4"/>
<text class="label" x="40" y="780" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="400" y="766" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">packing</text>
</g>
<rect class="region" x="32" y="804" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="817" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="400" y="814" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="129.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="137.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="316.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="324.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.checklist.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Checklist — web-wide">
<title>Checklist — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="820"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="1424" height="668" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tasks</text>
<text class="name" x="1450" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tasks</text>
<rect class="region" x="36" y="96" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="36" y="176" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="36" y="256" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Task · who · done</text>
<rect class="region" x="32" y="756" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="784" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add a task</text>
<text class="name" x="1450" y="766" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-task</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1320.5 762 V760 A3 3 0 0 1 1326.5 760 V762"/><rect x="1319.5" y="762" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1401" y="766" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="32" y="812" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1" stroke-dasharray="6 4"/>
<text class="label" x="40" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="1450" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">packing</text>
</g>
<rect class="region" x="32" y="860" width="1424" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="873" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="1450" y="870" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="392" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="400" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="748" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="756" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="1104" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="1112" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.day.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Day — phone">
<title>Day — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="62" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · date · place</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="86" width="362" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M38 86 L400 286 M400 86 L38 286" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="190" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">The day&#39;s places in order</text>
<text class="name" x="394" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">route</text>
<rect class="region" x="38" y="294" width="362" height="504" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="307" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">activities</text>
<text class="name" x="394" y="304" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activities</text>
<rect class="region" x="42" y="310" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="350" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="42" y="390" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="430" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="42" y="470" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="510" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M291.5 812 V810 A3 3 0 0 1 297.5 810 V812"/><rect x="290.5" y="812" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="372" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.day.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Day — web-narrow">
<title>Day — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · date · place</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="374" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 80 L406 280 M406 80 L32 280" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="184" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">The day&#39;s places in order</text>
<text class="name" x="400" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">route</text>
<rect class="region" x="32" y="288" width="374" height="516" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="301" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">activities</text>
<text class="name" x="400" y="298" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activities</text>
<rect class="region" x="36" y="304" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="344" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="36" y="384" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="424" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="36" y="464" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="504" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M297.5 818 V816 A3 3 0 0 1 303.5 816 V818"/><rect x="296.5" y="818" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="378" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.day.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Day — web-wide">
<title>Day — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · date · place</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="1424" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 80 L1456 280 M1456 80 L32 280" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="184" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">The day&#39;s places in order</text>
<text class="name" x="1450" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">route</text>
<rect class="region" x="32" y="288" width="1424" height="572" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="301" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">activities</text>
<text class="name" x="1450" y="298" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">activities</text>
<rect class="region" x="36" y="304" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="344" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="36" y="384" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="424" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="36" y="464" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="504" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1347.5 874 V872 A3 3 0 0 1 1353.5 872 V874"/><rect x="1346.5" y="874" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1428" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.inbox.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Inbox — phone">
<title>Inbox — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="752"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="62" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="86" width="362" height="704" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="99" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">invitations</text>
<text class="name" x="394" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invitations</text>
<rect class="region" x="42" y="102" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="142" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="42" y="182" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="222" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="42" y="262" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="302" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
</g>
<rect class="region" x="38" y="798" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="811" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="394" y="808" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="42" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="132.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="140.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="313.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="321.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.inbox.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Inbox — web-narrow">
<title>Inbox — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="764"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="374" height="716" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">invitations</text>
<text class="name" x="400" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invitations</text>
<rect class="region" x="36" y="96" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="36" y="176" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="36" y="256" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
</g>
<rect class="region" x="32" y="804" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="817" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="400" y="814" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="129.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="137.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="316.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="324.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.inbox.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Inbox — web-wide">
<title>Inbox — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="820"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="1424" height="772" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">invitations</text>
<text class="name" x="1450" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">invitations</text>
<rect class="region" x="36" y="96" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="36" y="176" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
<rect class="region" x="36" y="256" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activity · day · invited by</text>
</g>
<rect class="region" x="32" y="860" width="1424" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="873" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="1450" y="870" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="392" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="400" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="748" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="756" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="1104" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="1112" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.info.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Trip info — phone">
<title>Trip info — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="70" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">This trip has ended</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">ended</text>
<rect class="region" x="38" y="102" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="126" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="394" y="112" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="150" width="362" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="166" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates · places · nights</text>
<text class="name" x="394" y="160" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">summary</text>
<rect class="region" x="38" y="182" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="206" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">People</text>
<text class="name" x="394" y="192" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M302.5 188 V186 A3 3 0 0 1 308.5 186 V188"/><rect x="301.5" y="188" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="355.5" y="192" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<rect class="region" x="38" y="230" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="254" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Share the join code</text>
<text class="name" x="394" y="240" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join-code</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M259 236 V234 A3 3 0 0 1 265 234 V236"/><rect x="258" y="236" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="339.5" y="240" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.info.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Trip info — web-narrow">
<title>Trip info — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="64" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">This trip has ended</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">ended</text>
<rect class="region" x="32" y="96" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="120" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="400" y="106" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="144" width="374" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="160" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates · places · nights</text>
<text class="name" x="400" y="154" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">summary</text>
<rect class="region" x="32" y="176" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="200" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">People</text>
<text class="name" x="400" y="186" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M308.5 182 V180 A3 3 0 0 1 314.5 180 V182"/><rect x="307.5" y="182" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="361.5" y="186" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<rect class="region" x="32" y="224" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="248" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Share the join code</text>
<text class="name" x="400" y="234" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join-code</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M265 230 V228 A3 3 0 0 1 271 228 V230"/><rect x="264" y="230" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="345.5" y="234" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.info.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Trip info — web-wide">
<title>Trip info — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="64" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">This trip has ended</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">ended</text>
<rect class="region" x="32" y="96" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="120" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name</text>
<text class="name" x="1450" y="106" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="144" width="1424" height="24" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="160" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Dates · places · nights</text>
<text class="name" x="1450" y="154" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">summary</text>
<rect class="region" x="32" y="176" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="200" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">People</text>
<text class="name" x="1450" y="186" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">people</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1358.5 182 V180 A3 3 0 0 1 1364.5 180 V182"/><rect x="1357.5" y="182" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1411.5" y="186" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<rect class="region" x="32" y="224" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="248" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Share the join code</text>
<text class="name" x="1450" y="234" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">join-code</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1315 230 V228 A3 3 0 0 1 1321 228 V230"/><rect x="1314" y="230" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1395.5" y="234" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">manageMembers</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.map.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Trip map — phone">
<title>Trip map — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="752"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M38 38 L400 238 M400 38 L38 238" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="142" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activities on the map</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">map</text>
</g>
<rect class="region" x="38" y="798" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="811" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="394" y="808" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="42" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="132.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="140.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="313.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="321.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.map.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Trip map — web-narrow">
<title>Trip map — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="764"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 32 L406 232 M406 32 L32 232" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activities on the map</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">map</text>
</g>
<rect class="region" x="32" y="804" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="817" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="400" y="814" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="129.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="137.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="316.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="324.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.map.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Trip map — web-wide">
<title>Trip map — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="820"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="200" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M32 32 L1456 232 M1456 32 L32 232" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Activities on the map</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">map</text>
</g>
<rect class="region" x="32" y="860" width="1424" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="873" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="1450" y="870" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="392" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="400" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="748" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="756" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="1104" y="876" width="348" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="1112" y="898" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.packing.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Packing list — phone">
<title>Packing list — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="38" y="38" width="362" height="816"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="38" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="62" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="38" y="86" width="362" height="712" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="99" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">items</text>
<text class="name" x="394" y="96" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">items</text>
<rect class="region" x="42" y="102" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="142" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="42" y="182" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="222" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="42" y="262" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="302" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="38" y="806" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="834" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add an item</text>
<text class="name" x="394" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-item</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M275.5 812 V810 A3 3 0 0 1 281.5 810 V812"/><rect x="274.5" y="812" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="345" y="816" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editPacking</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.packing.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Packing list — web-narrow">
<title>Packing list — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="374" height="828"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="374" height="724" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">items</text>
<text class="name" x="400" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">items</text>
<rect class="region" x="36" y="96" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="36" y="176" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="36" y="256" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="32" y="812" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="840" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add an item</text>
<text class="name" x="400" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-item</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M281.5 818 V816 A3 3 0 0 1 287.5 816 V818"/><rect x="280.5" y="818" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="351" y="822" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editPacking</text>
</g>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.packing.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Packing list — web-wide">
<title>Packing list — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="56" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Packing list</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="32" y="80" width="1424" height="780" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="93" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">items</text>
<text class="name" x="1450" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">items</text>
<rect class="region" x="36" y="96" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="136" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="36" y="176" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="216" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="36" y="256" width="1416" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="296" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Item · who packs it · packed</text>
<rect class="region" x="32" y="868" width="1424" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="896" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add an item</text>
<text class="name" x="1450" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-item</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M1331.5 874 V872 A3 3 0 0 1 1337.5 872 V874"/><rect x="1330.5" y="874" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="1401" y="878" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editPacking</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.timeline.phone.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Timeline — phone">
<title>Timeline — phone</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="region" x="38" y="38" width="362" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="51" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="394" y="48" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="42" y="54" width="173" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="72" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name · dates</text>
<text class="name" x="209" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="223" y="54" width="173" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="72" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Info</text>
<text class="name" x="390" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">info</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M309 60 V58 A3 3 0 0 1 315 58 V60"/><rect x="308" y="60" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="362.5" y="64" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<defs><clipPath id="sb-clip"><rect x="38" y="94" width="362" height="696"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="38" y="94" width="362" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="118" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · place · weather</text>
<text class="name" x="394" y="104" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day-heading</text>
<rect class="region" x="38" y="142" width="362" height="592" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="155" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">days</text>
<text class="name" x="394" y="152" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">days</text>
<rect class="region" x="42" y="158" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="198" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="42" y="238" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="278" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="42" y="318" width="354" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="358" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="38" y="742" width="362" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="770" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="394" y="752" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-activity</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M243 748 V746 A3 3 0 0 1 249 746 V748"/><rect x="242" y="748" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="323" y="752" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="region" x="38" y="798" width="362" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="46" y="811" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="394" y="808" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="42" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="50" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="132.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="140.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="313.5" y="814" width="82.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="321.5" y="836" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="28" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.timeline.web-narrow.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="438" height="892" viewBox="0 0 438 892" role="img" aria-label="Timeline — web-narrow">
<title>Timeline — web-narrow</title>
<rect class="card" x="0" y="0" width="438" height="892" fill="#FFFFFF"/>
<rect class="region" x="32" y="32" width="374" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="400" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="36" y="48" width="179" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name · dates</text>
<text class="name" x="209" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="223" y="48" width="179" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="66" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Info</text>
<text class="name" x="396" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">info</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M315 54 V52 A3 3 0 0 1 321 52 V54"/><rect x="314" y="54" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="368.5" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<defs><clipPath id="sb-clip"><rect x="32" y="88" width="374" height="708"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="88" width="374" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="112" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · place · weather</text>
<text class="name" x="400" y="98" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day-heading</text>
<rect class="region" x="32" y="136" width="374" height="604" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="149" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">days</text>
<text class="name" x="400" y="146" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">days</text>
<rect class="region" x="36" y="152" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="192" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="36" y="232" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="272" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="36" y="312" width="366" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="352" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="32" y="748" width="374" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="776" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="400" y="758" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-activity</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M249 754 V752 A3 3 0 0 1 255 752 V754"/><rect x="248" y="754" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="329" y="758" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
</g>
<rect class="region" x="32" y="804" width="374" height="56" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="817" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="400" y="814" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="36" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="129.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="137.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="223" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="231" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="316.5" y="820" width="85.5" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="324.5" y="842" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="frame" x="24" y="24" width="390" height="844" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/generated/wireframes/trip.timeline.web-wide.svg":`<svg xmlns="http://www.w3.org/2000/svg" width="1488" height="948" viewBox="0 0 1488 948" role="img" aria-label="Timeline — web-wide">
<title>Timeline — web-wide</title>
<rect class="card" x="0" y="0" width="1488" height="948" fill="#FFFFFF"/>
<defs><clipPath id="sb-clip"><rect x="32" y="32" width="1424" height="884"/></clipPath></defs>
<g clip-path="url(#sb-clip)">
<rect class="region" x="32" y="32" width="1424" height="884" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="40" y="45" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">shell</text>
<text class="name" x="1450" y="42" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">shell</text>
<rect class="region" x="36" y="48" width="220" height="864" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="44" y="61" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">tabs</text>
<text class="name" x="250" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">tabs</text>
<rect class="item" x="40" y="64" width="212" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="86" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Timeline</text>
<rect class="item" x="40" y="108" width="212" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="130" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Checklist</text>
<rect class="item" x="40" y="152" width="212" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="174" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Inbox</text>
<rect class="item" x="40" y="196" width="212" height="36" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="48" y="218" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Map</text>
<rect class="region" x="264" y="48" width="713.5" height="864" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="272" y="61" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">main</text>
<text class="name" x="971.5" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">main</text>
<rect class="region" x="268" y="64" width="705.5" height="48" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="276" y="77" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">app-bar</text>
<text class="name" x="967.5" y="74" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">app-bar</text>
<rect class="region" x="272" y="80" width="344.5" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="280" y="98" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Trip name · dates</text>
<text class="name" x="610.5" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">title</text>
<rect class="region" x="624.5" y="80" width="344.5" height="28" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="632.5" y="98" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Info</text>
<text class="name" x="963.5" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">info</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M882.5 86 V84 A3 3 0 0 1 888.5 84 V86"/><rect x="881.5" y="86" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="935.5" y="90" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">viewTrip</text>
<rect class="region" x="268" y="120" width="705.5" height="40" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="276" y="144" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Day · place · weather</text>
<text class="name" x="967.5" y="130" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day-heading</text>
<rect class="region" x="268" y="168" width="705.5" height="684" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="276" y="181" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">days</text>
<text class="name" x="967.5" y="178" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">days</text>
<rect class="region" x="272" y="184" width="697.5" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="280" y="224" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="272" y="264" width="697.5" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="280" y="304" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="272" y="344" width="697.5" height="72" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="280" y="384" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Time · activity · who is going</text>
<rect class="region" x="268" y="860" width="705.5" height="48" rx="4" fill="#C9C9C1" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="276" y="888" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">Add activity</text>
<text class="name" x="967.5" y="870" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">add-activity</text>
<g class="lock" fill="none" stroke="#5B5F66" stroke-width="1"><path d="M816.5 866 V864 A3 3 0 0 1 822.5 864 V866"/><rect x="815.5" y="866" width="8" height="5" rx="1" fill="#5B5F66"/></g>
<text class="cap" x="896.5" y="870" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">editLogistics</text>
<rect class="region" x="985.5" y="48" width="466.5" height="864" rx="4" fill="#ECECE6" stroke="#9A9A92" stroke-width="1"/>
<path class="placeholder" d="M985.5 48 L1452 912 M1452 48 L985.5 912" stroke="#9A9A92" stroke-width="1"/>
<text class="label" x="993.5" y="484" font-size="12" font-family="system-ui, -apple-system, Segoe UI, sans-serif" fill="#2E3135">The day&#39;s places</text>
<text class="name" x="1446" y="58" text-anchor="end" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace" fill="#5B5F66">day-map</text>
</g>
<rect class="frame" x="24" y="24" width="1440" height="900" rx="8" fill="none" stroke="#9A9A92" stroke-width="2"/>
</svg>
`,"../../../examples/travel-app/docs/flows/screens.yaml":`screens:
  auth.sign-in:
    title: Sign in
    area: auth
    purpose: Sign in with an email address and a password.
    presentation: push
    files:
      ios: [src/ios/Screens/Auth/SignInView.swift]
      android: [src/android/SignInScreen.kt]
      web: [src/web/routes/sign-in/+page.svelte]
    layout:
      - region: credentials
        kind: section
        children:
          - {region: email, kind: field, label: Email address}
          - {region: password, kind: field, label: Password}
      - {region: sign-in, kind: primary-action, label: Sign in, to: home.trips}
      - {region: forgot, kind: action, label: Forgot password}
      - {region: sign-up, kind: action, label: Create an account instead, to: auth.sign-up}
  auth.sign-up:
    title: Create an account
    area: auth
    purpose: Create an account with a name, an email address and a password.
    presentation: push
    files:
      ios: [src/ios/Screens/Auth/SignUpView.swift]
      android: [src/android/SignUpScreen.kt]
      web: [src/web/routes/sign-up/+page.svelte]
    layout:
      - {region: details, kind: form, label: Name · email · password}
      - {region: terms, kind: text, label: What signing up agrees to}
      - {region: create, kind: primary-action, label: Create account, to: home.trips}
      - {region: sign-in, kind: action, label: I have an account, to: auth.sign-in}
  auth.welcome:
    title: Welcome
    area: auth
    purpose: The first screen of a signed-out app; create an account or sign in.
    presentation: root
    files:
      ios: [src/ios/Screens/Auth/WelcomeView.swift]
      android: [src/android/WelcomeScreen.kt]
      web: [src/web/routes/welcome/+page.svelte]
    layout:
      - {region: hero, kind: media, label: Illustration of a map and a suitcase}
      - {region: pitch, kind: text, label: Plan trips with the people going}
      - {region: sign-up, kind: primary-action, label: Create an account, to: auth.sign-up}
      - {region: sign-in, kind: action, label: I have an account, to: auth.sign-in}
  home.new-trip:
    title: New trip
    area: home
    purpose: Name a trip and choose its dates.
    presentation: sheet
    files:
      ios: [src/ios/Screens/Home/NewTripView.swift]
      android: [src/android/NewTripScreen.kt]
      web: [src/web/components/NewTripSheet.svelte]
    layout:
      - region: details
        kind: section
        children:
          - {region: name, kind: field, label: Trip name}
          - {region: dates, kind: field, label: Dates}
          - {region: where, kind: field, label: Where to}
      - {region: create, kind: primary-action, label: Create trip, to: trip.timeline}
  home.trips:
    title: Your trips
    area: home
    purpose: Every trip you plan or travel on, the next one first.
    presentation: root
    files:
      ios: [src/ios/Screens/Home/TripsView.swift]
      android: [src/android/TripsScreen.kt]
      web: [src/web/routes/+page.svelte]
    layout:
      - region: app-bar
        kind: bar
        children:
          - {region: title, kind: header, label: Trips}
          - {region: settings, kind: action, label: Settings, to: settings.main}
      - {region: offline, kind: banner, label: Offline · changes sync later}
      - region: trips
        kind: list
        item: {kind: card, label: Trip · dates · people, to: trip.timeline}
        empty:
          label: No trips yet
      - {region: join, kind: action, label: Join with a code, to: sharing.join}
      - {region: new-trip, kind: primary-action, label: New trip, to: home.new-trip}
  trip.checklist:
    title: Checklist
    area: trip
    purpose: What has to be done before the trip, and who is doing it.
    presentation: tab
    files:
      ios: [src/ios/Screens/Trip/ChecklistView.swift]
      android: [src/android/ChecklistScreen.kt]
      web: [src/web/routes/trip/checklist/+page.svelte]
    layout:
      - {region: title, kind: header, label: Checklist}
      - region: tasks
        kind: list
        item: {kind: card, label: Task · who · done}
        empty:
          label: Nothing to do yet
      - {region: add-task, kind: primary-action, label: Add a task, requires: editLogistics}
      - {region: packing, kind: action, label: Packing list, to: trip.packing, status: proposed}
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
          - {label: Inbox, to: trip.inbox}
          - {label: Map, to: trip.map}
  trip.day:
    title: Day
    area: trip
    purpose: One day of the trip on its own, with its places on a map.
    presentation: push
    files:
      ios: [src/ios/Screens/Trip/DayView.swift]
      android: [src/android/DayScreen.kt]
      web: [src/web/routes/trip/day/+page.svelte]
    layout:
      - {region: title, kind: header, label: Day · date · place}
      - {region: route, kind: map, label: The day's places in order}
      - region: activities
        kind: list
        item: {kind: card, label: Time · activity, to: activity.detail}
        empty:
          label: Nothing planned this day
      - region: add
        kind: primary-action
        label: Add activity
        to: activity.add
        requires: editLogistics
  trip.inbox:
    title: Inbox
    area: trip
    purpose: The invitations to activities that you have not answered yet.
    presentation: tab
    files:
      ios: [src/ios/Screens/Trip/InboxView.swift]
      android: [src/android/InboxScreen.kt]
      web: [src/web/routes/trip/inbox/+page.svelte]
    layout:
      - {region: title, kind: header, label: Inbox}
      - region: invitations
        kind: list
        item: {kind: card, label: Activity · day · invited by, to: activity.detail}
        empty:
          label: Nothing to answer
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
          - {label: Inbox, to: trip.inbox}
          - {label: Map, to: trip.map}
  trip.info:
    title: Trip info
    area: trip
    purpose: The trip's dates, places and people, and its join code.
    presentation: push
    files:
      ios: [src/ios/Screens/Trip/TripInfoView.swift]
      android: [src/android/TripInfoScreen.kt]
      web: [src/web/routes/trip/info/+page.svelte]
    layout:
      - {region: ended, kind: banner, label: This trip has ended}
      - {region: title, kind: header, label: Trip name}
      - {region: summary, kind: text, label: Dates · places · nights}
      - {region: people, kind: action, label: People, to: sharing.roster, requires: viewTrip}
      - {region: join-code, kind: action, label: Share the join code, requires: manageMembers}
  trip.map:
    title: Trip map
    area: trip
    purpose: Where each activity is, day by day.
    presentation: tab
    files:
      ios: [src/ios/Screens/Trip/TripMapView.swift]
      android: [src/android/TripMapScreen.kt]
      web: [src/web/routes/trip/map/+page.svelte]
    layout:
      - {region: map, kind: map, label: Activities on the map}
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
          - {label: Inbox, to: trip.inbox}
          - {label: Map, to: trip.map}
  trip.packing:
    title: Packing list
    area: trip
    purpose: What to bring, and who brings each thing so nothing is packed twice.
    presentation: push
    status: proposed
    # None of these files exists yet, on purpose: a proposed screen names the
    # files it will have before they are written, and file-missing does not
    # check them until the screen stops being proposed.
    files:
      ios: [src/ios/Screens/Trip/PackingView.swift]
      android: [src/android/PackingScreen.kt]
      web: [src/web/routes/trip/packing/+page.svelte]
    layout:
      - {region: title, kind: header, label: Packing list}
      - region: items
        kind: list
        item: {kind: card, label: Item · who packs it · packed}
        empty:
          label: Nothing on the list yet
      - {region: add-item, kind: primary-action, label: Add an item, requires: editPacking}
  trip.timeline:
    title: Timeline
    area: trip
    purpose: The trip's days in order, with what happens on each; the trip's first tab.
    presentation: tab
    states: [empty, ended, read-only]
    files:
      ios: [src/ios/Screens/Trip/TimelineView.swift]
      android: [src/android/TimelineScreen.kt]
      web: [src/web/routes/trip/timeline/+page.svelte]
    layout:
      - region: app-bar
        kind: bar
        children:
          - {region: title, kind: header, label: Trip name · dates}
          - {region: info, kind: action, label: Info, to: trip.info, requires: viewTrip}
      - {region: day-heading, kind: header, label: Day · place · weather, to: trip.day}
      - region: days
        kind: list
        item: {kind: card, label: Time · activity · who is going, to: activity.detail}
        empty:
          label: No activities yet
      - region: add-activity
        kind: primary-action
        label: Add activity
        to: activity.add
        requires: editLogistics
      - region: tabs
        kind: tabs
        items:
          - {label: Timeline, to: trip.timeline}
          - {label: Checklist, to: trip.checklist}
          - {label: Inbox, to: trip.inbox}
          - {label: Map, to: trip.map}
    layouts:
      web-wide:
        - region: shell
          kind: row
          children:
            - region: tabs
              kind: nav
              width: 220
              items:
                - {label: Timeline, to: trip.timeline}
                - {label: Checklist, to: trip.checklist}
                - {label: Inbox, to: trip.inbox}
                - {label: Map, to: trip.map}
            - region: main
              kind: column
              children:
                - region: app-bar
                  kind: bar
                  children:
                    - {region: title, kind: header, label: Trip name · dates}
                    - {region: info, kind: action, label: Info, to: trip.info, requires: viewTrip}
                - {region: day-heading, kind: header, label: Day · place · weather, to: trip.day}
                - region: days
                  kind: list
                  item: {kind: card, label: Time · activity · who is going, to: activity.detail}
                  empty:
                    label: No activities yet
                - region: add-activity
                  kind: primary-action
                  label: Add activity
                  to: activity.add
                  requires: editLogistics
            - {region: day-map, kind: map, label: The day's places, width: 1/3}
  activity.add:
    title: Add activity
    area: activity
    purpose: Put something on one day of the trip.
    presentation: sheet
    files:
      ios: [src/ios/Screens/Activity/ActivityEditorView.swift]
      android: [src/android/ActivityEditorScreen.kt]
      web: [src/web/components/ActivityEditorSheet.svelte]
    layout:
      - region: form
        kind: section
        children:
          - {region: title, kind: field, label: What}
          - {region: day, kind: field, label: Day}
          - {region: time, kind: field, label: Time}
          - {region: place, kind: field, label: Place, to: activity.place-search}
          - region: category
            kind: menu
            items:
              - {label: Food}
              - {label: Sight}
              - {label: Travel}
      - {region: save, kind: primary-action, label: Save, to: trip.timeline}
  activity.detail:
    title: Activity
    area: activity
    purpose: One activity's time, place, notes and who is going.
    presentation: push
    files:
      ios: [src/ios/Screens/Activity/ActivityDetailView.swift]
      android: [src/android/ActivityDetailScreen.kt]
      web: [src/web/routes/trip/activity/+page.svelte]
    layout:
      - {region: title, kind: header, label: Activity name}
      - {region: when, kind: text, label: Day and time}
      - {region: where, kind: map, label: Place}
      - region: attendance
        kind: section
        children:
          - {region: going, kind: text, label: Who is going · who is invited}
          - {region: answer, kind: action, label: Going or not, requires: answerInvitations}
          - region: invite
            kind: action
            label: Invite
            to: activity.invite
            requires: editLogistics
      - {region: notes, kind: text, label: Notes}
      - {region: edit, kind: action, label: Edit, to: activity.add, requires: editLogistics}
  activity.invite:
    title: Invite to activity
    area: activity
    purpose: Ask travellers on the trip to come to one activity.
    presentation: sheet
    files:
      ios: [src/ios/Screens/Activity/ActivityInviteView.swift]
      android: [src/android/ActivityInviteScreen.kt]
      web: [src/web/components/ActivityInviteSheet.svelte]
    layout:
      - {region: activity, kind: header, label: Activity name · day}
      - region: travellers
        kind: list
        item: {kind: card, label: Traveller · invited already}
        empty:
          label: Everyone is invited
      - {region: send, kind: primary-action, label: Send invitations, to: activity.detail}
  activity.place-search:
    title: Find a place
    area: activity
    purpose: Search for the place an activity happens.
    presentation: push
    files:
      ios: [src/ios/Screens/Activity/PlaceSearchView.swift]
      android: [src/android/PlaceSearchScreen.kt]
      web: [src/web/components/PlaceSearch.svelte]
    layout:
      - {region: search, kind: field, label: Search places}
      - region: results
        kind: list
        item: {kind: card, label: Place, to: activity.add}
        empty:
          label: No places match
  sharing.invite:
    title: Invite someone
    area: sharing
    purpose: Send an invitation to the trip by email.
    presentation: sheet
    status:
      ios: shipped
      android: proposed
      web: shipped
    files:
      ios: [src/ios/Screens/Sharing/InviteView.swift]
      android: [src/android/InviteScreen.kt]
      web: [src/web/components/InviteSheet.svelte]
    layout:
      - {region: email, kind: field, label: Email address}
      - region: role
        kind: menu
        items:
          - {label: Organizer}
          - {label: Traveller}
          - {label: Viewer}
      - {region: send, kind: primary-action, label: Send invite, to: sharing.roster}
  sharing.join:
    title: Join a trip
    area: sharing
    purpose: Join a trip with the code its organizer shared.
    presentation: dialog
    files:
      ios: [src/ios/Screens/Sharing/JoinView.swift]
      android: [src/android/JoinScreen.kt]
      web: [src/web/components/JoinDialog.svelte]
    layout:
      - {region: explain, kind: text, label: Type the code you were sent}
      - {region: code, kind: field, label: Join code}
      - {region: join, kind: primary-action, label: Join, to: trip.timeline}
      - {region: cancel, kind: action, label: Cancel, to: home.trips}
  sharing.roster:
    title: People
    area: sharing
    purpose: Who is on the trip and what each person may do.
    presentation: push
    files:
      ios: [src/ios/Screens/Sharing/RosterView.swift]
      android: [src/android/RosterScreen.kt]
      web: [src/web/routes/trip/people/+page.svelte]
    layout:
      - region: people
        kind: list
        item: {kind: card, label: Traveller · role}
        empty:
          label: Only you so far
      - region: invite
        kind: primary-action
        label: Invite someone
        to: sharing.invite
        requires: manageMembers
  settings.account:
    title: Account
    area: settings
    purpose: Change your name, email and password, or delete the account.
    presentation: push
    platforms: [ios, android]
    platformNote: The web changes the account on the settings page itself.
    files:
      ios: [src/ios/Screens/Settings/AccountView.swift]
      android: [src/android/AccountScreen.kt]
    layout:
      - region: details
        kind: section
        children:
          - {region: name, kind: field, label: Name}
          - {region: email, kind: field, label: Email address}
      - {region: password, kind: action, label: Change password}
      - {region: delete, kind: action, label: Delete account, to: auth.welcome}
  settings.main:
    title: Settings
    area: settings
    purpose: Your profile, how the app behaves, and signing out.
    presentation: push
    files:
      ios: [src/ios/Screens/Settings/SettingsView.swift]
      android: [src/android/SettingsScreen.kt]
      web: [src/web/routes/settings/+page.svelte]
    layout:
      - region: profile
        kind: section
        children:
          - {region: name, kind: text, label: Name · email}
          - {region: account, kind: action, label: Account, to: settings.account}
      - region: preferences
        kind: section
        children:
          - {region: units, kind: field, label: Units}
          - {region: notifications, kind: field, label: Notifications}
      - {region: sign-out, kind: action, label: Sign out, to: auth.welcome}
`,"../../../examples/travel-app/src/android/AccountScreen.kt":``,"../../../examples/travel-app/src/android/ActivityDetailScreen.kt":``,"../../../examples/travel-app/src/android/ActivityEditorScreen.kt":``,"../../../examples/travel-app/src/android/ActivityInviteScreen.kt":``,"../../../examples/travel-app/src/android/ChecklistScreen.kt":``,"../../../examples/travel-app/src/android/DayScreen.kt":``,"../../../examples/travel-app/src/android/InboxScreen.kt":``,"../../../examples/travel-app/src/android/JoinScreen.kt":``,"../../../examples/travel-app/src/android/NewTripScreen.kt":``,"../../../examples/travel-app/src/android/PlaceSearchScreen.kt":``,"../../../examples/travel-app/src/android/RosterScreen.kt":``,"../../../examples/travel-app/src/android/SettingsScreen.kt":``,"../../../examples/travel-app/src/android/SignInScreen.kt":``,"../../../examples/travel-app/src/android/SignUpScreen.kt":``,"../../../examples/travel-app/src/android/TimelineScreen.kt":``,"../../../examples/travel-app/src/android/TripInfoScreen.kt":``,"../../../examples/travel-app/src/android/TripMapScreen.kt":``,"../../../examples/travel-app/src/android/TripsScreen.kt":``,"../../../examples/travel-app/src/android/WelcomeScreen.kt":``,"../../../examples/travel-app/src/ios/Screens/Activity/ActivityDetailView.swift":``,"../../../examples/travel-app/src/ios/Screens/Activity/ActivityEditorView.swift":``,"../../../examples/travel-app/src/ios/Screens/Activity/ActivityInviteView.swift":``,"../../../examples/travel-app/src/ios/Screens/Activity/PlaceSearchView.swift":``,"../../../examples/travel-app/src/ios/Screens/Auth/SignInView.swift":``,"../../../examples/travel-app/src/ios/Screens/Auth/SignUpView.swift":``,"../../../examples/travel-app/src/ios/Screens/Auth/WelcomeView.swift":``,"../../../examples/travel-app/src/ios/Screens/Home/NewTripView.swift":``,"../../../examples/travel-app/src/ios/Screens/Home/TripsView.swift":``,"../../../examples/travel-app/src/ios/Screens/Settings/AccountView.swift":``,"../../../examples/travel-app/src/ios/Screens/Settings/SettingsView.swift":``,"../../../examples/travel-app/src/ios/Screens/Sharing/InviteView.swift":``,"../../../examples/travel-app/src/ios/Screens/Sharing/JoinView.swift":``,"../../../examples/travel-app/src/ios/Screens/Sharing/RosterView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/ChecklistView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/DayView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/InboxView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/TimelineView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/TripInfoView.swift":``,"../../../examples/travel-app/src/ios/Screens/Trip/TripMapView.swift":``,"../../../examples/travel-app/src/web/components/ActivityEditorSheet.svelte":``,"../../../examples/travel-app/src/web/components/ActivityInviteSheet.svelte":``,"../../../examples/travel-app/src/web/components/InviteSheet.svelte":``,"../../../examples/travel-app/src/web/components/JoinDialog.svelte":``,"../../../examples/travel-app/src/web/components/NewTripSheet.svelte":``,"../../../examples/travel-app/src/web/components/PlaceSearch.svelte":``,"../../../examples/travel-app/src/web/routes/+page.svelte":``,"../../../examples/travel-app/src/web/routes/settings/+page.svelte":``,"../../../examples/travel-app/src/web/routes/sign-in/+page.svelte":``,"../../../examples/travel-app/src/web/routes/sign-up/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/activity/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/checklist/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/day/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/inbox/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/info/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/map/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/people/+page.svelte":``,"../../../examples/travel-app/src/web/routes/trip/timeline/+page.svelte":``,"../../../examples/travel-app/src/web/routes/welcome/+page.svelte":``,"../../../examples/travel-app/starboard.yaml":`# An invented trip-planning app: the example the web app opens
# from "Explore the example project", and the project the docs walk through.
version: 1
platforms:
  ios:
    formFactors: [phone]
    roots: [src/ios/Screens]
    screenFiles: ["**/*View.swift"]
  android:
    formFactors: [phone]
    roots: [src/android]
    screenFiles: ["*Screen.kt"]
  web:
    formFactors: [web-narrow, web-wide]
    roots: [src/web/routes]
    screenFiles: ["**/+page.svelte"]
vocabularies:
  requires:
    file: capabilities.json
    select: .capabilities[].name
areas: [auth, home, trip, activity, sharing, settings]
`}),t=`travel-app`,n=Object.fromEntries(Object.entries(e).map(([e,t])=>[e.slice(29),t]));export{t as EXAMPLE_NAME,n as exampleFiles};
//# sourceMappingURL=example-DqwSJik_.js.map