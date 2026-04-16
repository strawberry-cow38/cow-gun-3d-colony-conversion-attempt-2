/**
 * Colonist backstory pools — Y2K-flavored, semi-satirical, a little sad.
 * Rolled once at spawn and frozen on Identity; the UI reads them to flesh
 * out the cow's Bio tab.
 *
 * Entries may tag themselves with `titles: ['Dr.', ...]` to restrict who
 * they apply to. Prestige-title cows (Dr./Prof./Col.) roll from their
 * flavored pool 70% of the time and fall back to the generic pool the rest;
 * plain-title cows (Mr./Mrs./Ms./Mx.) ignore the flavored entries. The
 * generic pool stays funny for everyone so a Dr. can plausibly be a
 * recovering used-tire-salesman with a medical degree they regret.
 *
 * Real-world brands, institutions, and named wars/places are avoided —
 * we're building our own Y2K-adjacent world, not referencing existing
 * media. Descriptions (on professions) populate the hover tooltip in the
 * cow Bio panel as: "(NAME) worked as a (text), (description)".
 */

const TITLE_MATCH_CHANCE = 0.7;

/**
 * @typedef BackstoryEntry
 * @property {string} text
 * @property {string[]} [titles]  if present, only cows with these titles roll this entry
 */

/**
 * @typedef ProfessionEntry
 * @property {string} text
 * @property {string} description  gerund-phrase flavor shown in the hover tooltip
 * @property {string[]} [titles]
 */

/** @type {BackstoryEntry[]} */
const CHILDHOODS = [
  { text: 'raised on a dairy farm' },
  { text: 'latchkey kid with a virtual-pet collection' },
  { text: 'suburban cul-de-sac rat' },
  { text: 'spent every summer at bible camp' },
  { text: 'collected bottle caps, lost them all in a schoolyard tournament' },
  { text: 'homeschooled by conspiracy theorists' },
  { text: 'mowed lawns all summer for saxophone money' },
  { text: 'lived above a family-owned pizzeria' },
  { text: 'ran a newspaper route on a hand-me-down bike' },
  { text: 'got grounded for burning dial-up trial CDs' },
  { text: 'dropped out of the church choir after a voice crack' },
  { text: 'eldest of eleven siblings' },
  { text: 'trained as a concert pianist, quit at fourteen' },
  { text: 'placed third at the county fair pie-eating contest' },
  { text: 'won a blue ribbon for a baking-soda volcano' },
  { text: 'spent middle school in a LAN party basement' },
  { text: 'memorized every line of a sci-fi blockbuster' },
  { text: 'ran away to join a mall food court' },
  { text: 'bounced between three foster homes' },
  { text: 'raised by a single mom who sold cosmetics door-to-door' },
  { text: 'played pioneer simulators on a creaky classroom computer' },
  { text: 'was the neighborhood babysitter' },
  { text: 'got detention for modding the library computers' },
  { text: 'sold candy bars for a fundraiser that did not exist' },
  { text: 'built ramps for their friends’ skateboards' },
  { text: 'shared a room with three brothers and a rabbit' },
  { text: 'stole answers off the back of the worksheet' },
  { text: 'watched too much daytime TV during a long flu' },
  { text: 'grew up above a laundromat' },
  { text: 'spent weekends at the roller rink' },
  { text: 'had a paper route, pocketed tips for comic books' },
  { text: 'translated for their immigrant grandparents' },
  { text: 'raised by grandparents after a messy divorce' },
  { text: 'was the tallest kid in every class photo' },
  { text: 'had one friend with a pool, held it over them' },
  { text: 'spent fifth grade obsessed with UFO documentaries' },
  { text: 'collected stuffed animals as an investment strategy' },
  { text: 'played T-ball on a team that never won a game' },
  { text: 'was the class clown, peaked in eighth grade' },
  { text: 'won a local spelling bee on the word "bovine"' },
  { text: 'had a parrot that outlived two of the family pets' },
  { text: 'traded collectible cards at recess for lunch money' },
  { text: 'sold friendship bracelets at summer camp' },
  { text: 'was quietly the best kid in the marching band' },
  { text: 'fell off the gymnastics team after a wrist injury' },
  { text: 'ran their parents’ answering machine prank business' },
  { text: 'got a C in every subject except shop class' },
  { text: 'grew up watching courtroom drama reruns with grandpa' },
  { text: 'spent every Saturday morning at a swap meet' },
  { text: 'was in the scout troop until the canoeing incident' },
  { text: 'hosted a cable access show nobody watched' },
  { text: 'lived in a trailer park with strong community spirit' },
  { text: 'had a side hustle sweeping a video rental store after hours' },
  { text: 'detasseled corn every summer for minimum wage' },
  { text: 'got caught shoplifting a VHS and still feels guilty' },
  { text: 'had a coin collection their dad kept borrowing from' },
  { text: 'was a child pageant runner-up three years running' },
  { text: 'spent recess sitting under the slide reading spooky paperbacks' },
  { text: 'played clarinet in the middle school jazz band' },
  { text: 'was convinced they would be a figure skater' },
  { text: 'organized the yearbook club three years running' },
  { text: 'inherited the class pet after the teacher gave up' },
  { text: 'built a backyard treehouse condemned by the HOA' },
  { text: 'helped their dad run the pinewood derby' },
  { text: 'spent two summers at a woodworking camp' },
  { text: 'was known as the kid who could whistle with two fingers' },
  { text: 'eldest grandchild of a doomsday prepper' },
  { text: 'spent fifth grade collecting scented lip balms' },
  { text: 'ran a backyard spelling bee for fun' },
  { text: 'grew a crystal farm for a science fair' },
  { text: 'grew up sweeping hair at their aunt’s salon' },
  { text: 'was the unofficial neighborhood gossip' },
  { text: 'spent summers waxing their stepdad’s sailboat' },
  { text: 'did community theater and still name-drops it' },
  { text: 'was convinced they would headline as a stand-up comic' },
  { text: 'kept a detailed journal about a neighborhood ghost' },
  { text: 'was the only kid in class with a bread machine at home' },
  { text: 'had a Saturday-morning garage-sale habit' },
  { text: 'ran the school store during second-period break' },
  { text: 'got their first black eye in a dodgeball final' },
  { text: 'ran the mimeograph in the principal’s office during detention' },
  { text: 'had a cassette-tape phase they still defend' },
  { text: 'trained a ferret to do one trick' },
  { text: 'spent summers at their uncle’s lawnmower repair shop' },
  { text: 'was the kid parents hired to walk their dogs' },
  { text: 'sold hand-drawn comics at the lunch table' },

  { text: 'skipped two grades, still resents their parents for it', titles: ['Dr.', 'Prof.'] },
  { text: 'won the regional math olympiad three years running', titles: ['Dr.', 'Prof.'] },
  { text: 'published a science-fair paper in a local journal', titles: ['Dr.', 'Prof.'] },
  { text: 'debate team captain, three-time state champion', titles: ['Dr.', 'Prof.'] },
  { text: 'competitive chess prodigy on the regional circuit', titles: ['Dr.', 'Prof.'] },
  { text: 'built a working robot from VCR parts in seventh grade', titles: ['Dr.', 'Prof.'] },
  {
    text: 'got a perfect college-entrance score and has mentioned it every year since',
    titles: ['Dr.', 'Prof.'],
  },
  { text: 'interned at a research lab at fourteen', titles: ['Dr.', 'Prof.'] },
  { text: 'youngest trivia-club captain their high school ever had', titles: ['Dr.', 'Prof.'] },
  { text: 'skipped prom for an astronomy conference', titles: ['Dr.', 'Prof.'] },
  {
    text: 'home-built a custom open-source box in the garage at age twelve',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'tutored every one of their younger siblings through algebra',
    titles: ['Dr.', 'Prof.'],
  },
  { text: 'skipped recess daily for extra credit', titles: ['Dr.', 'Prof.'] },
  { text: 'spent two summers at a mock-diplomacy camp', titles: ['Dr.', 'Prof.'] },

  { text: 'only-child army brat who moved every two years', titles: ['Col.'] },
  { text: 'joined junior cadet corps in seventh grade', titles: ['Col.'] },
  { text: 'top-rank scout at thirteen', titles: ['Col.'] },
  { text: 'grew up on a desert air base', titles: ['Col.'] },
  { text: 'shipped to military school after the fireworks incident', titles: ['Col.'] },
  { text: 'ran a paintball league on the weekends', titles: ['Col.'] },
  { text: 'was the youngest kid at the shooting range every weekend', titles: ['Col.'] },
  { text: 'spent every summer in cadet corps', titles: ['Col.'] },
];

/** @type {ProfessionEntry[]} */
const PROFESSIONS = [
  {
    text: 'Used Tire Salesman',
    description:
      "patching sidewalls and insisting every tread 'had a few thousand miles left in it'",
  },
  {
    text: 'Video Rental Assistant Manager',
    description:
      'alphabetizing the horror shelf at 2am and writing passive-aggressive notes about late fees',
  },
  {
    text: 'Big Box Electronics Sales Associate',
    description: 'hand-selling extended warranties on 12-inch CRTs nobody actually wanted',
  },
  {
    text: 'Electronics Store Battery Specialist',
    description: 'memorizing every AA, AAA, and watch-battery code and nothing else',
  },
  {
    text: 'Dial-Up ISP Customer Retention Rep',
    description: 'reading a three-page breakup script to anyone who mentioned broadband',
  },
  {
    text: 'DMV Window #3 Clerk',
    description: "losing people's forms and blaming Window #2",
  },
  {
    text: 'Suburban Realtor (two luxury sedans)',
    description: 'printing their own face onto park benches and small fridge magnets',
  },
  {
    text: 'Collectible Plushie Authenticator',
    description: "squinting at hangtags under a jeweler's loupe all afternoon",
  },
  {
    text: 'IT Helpdesk Intern',
    description: 'walking middle-aged managers through how to turn on a monitor',
  },
  {
    text: 'Mall Kiosk Ear-Piercing Technician',
    description: 'firing a piercing gun at thirteen-year-olds and calling it an apprenticeship',
  },
  {
    text: 'Hotel Continental Breakfast Attendant',
    description: "refilling the waffle-mix jug and enforcing 'one muffin per guest'",
  },
  {
    text: 'Goth Mall Store Assistant Manager',
    description:
      'refolding the same fishnet tights twice a day and glaring at teens trying on boots',
  },
  {
    text: 'Chain Restaurant Flair Specialist',
    description: "stapling sixteen pieces of flair onto the new hire's vest",
  },
  {
    text: 'Dot-Com Startup Foosball Coordinator',
    description: 'scheduling midnight tournaments on the company expense account',
  },
  {
    text: 'Bowling Alley Shoe Sprayer',
    description: 'aerosoling disinfectant into size-twelves for eight consecutive hours',
  },
  {
    text: 'Used Car Lot Balloon Wrangler',
    description: 'untangling the lot balloons every Monday and losing three to the wind',
  },
  {
    text: 'Strip Mall Tanning Salon Owner',
    description: "maintaining a single bulb fleet and insisting 'the redness is normal'",
  },
  {
    text: 'Cable Company Installation Technician',
    description: 'drilling holes in the wrong wall and blaming the old wiring',
  },
  {
    text: 'SuperStore Layaway Clerk',
    description: "hiding other people's dolls behind a curtain on twelve-month installment plans",
  },
  {
    text: 'Pager Company Regional Sales Rep',
    description: 'cold-calling dentists about two-way paging features that did not work',
  },
  {
    text: 'Junior Accountant at a Disgraced Energy Firm',
    description: 'shredding things without reading them and quietly signing everything twice',
  },
  {
    text: 'Funeral Home Makeup Artist',
    description: "getting a little too good at contouring a grandma's cheekbones",
  },
  {
    text: 'Print Shop Supervisor',
    description: 'rescuing jammed toner cartridges and swearing at kids in the self-serve bay',
  },
  {
    text: 'Gas Station Attendant (scratch-off specialist)',
    description: 'silently judging scratch-off losers at 2am',
  },
  {
    text: 'Long-Distance Phone Card Reseller',
    description: 'selling the same expired card to three tourists before lunch',
  },
  {
    text: 'Pyramid Scheme Upline (silver tier)',
    description: 'booking hotel-ballroom rallies they had to rent on a personal check',
  },
  {
    text: 'Local News Weekend Weather Guy',
    description: 'waving at a chroma-keyed cloud on Saturday mornings for twenty-three viewers',
  },
  {
    text: 'Trucking Dispatch Night Shift',
    description: 'yelling coordinates into a CB radio at 3am',
  },
  {
    text: 'Self-published Poet (sold 40 copies)',
    description: 'workshopping couplets about minivans at the coffeehouse open mic',
  },
  {
    text: 'Pet Store Tarantula Specialist',
    description: 'hand-feeding crickets to a tarantula they accidentally named after an ex',
  },
  {
    text: 'Copier Repair Tech',
    description: 'arriving ninety minutes late with one screwdriver and extensive opinions',
  },
  {
    text: 'Wedding DJ (one speaker blown)',
    description: 'transitioning between three polka songs per reception',
  },
  {
    text: 'Drive-Thru Coffee Stand Operator',
    description: "arguing with a commuter about whether 'medium' is 12 or 14 ounces",
  },
  {
    text: 'Quick-Lube Middle Bay Technician',
    description: 'draining oil into the wrong pan exactly once a week',
  },
  {
    text: 'Funnel Cake Cart Owner',
    description: 'turning powdered sugar into airborne haze at county fairs',
  },
  {
    text: 'Stadium Hot Dog Vendor',
    description: "shouting 'Beeeeer heeeere' from the mezzanine level all night",
  },
  {
    text: 'Home Shopping Channel Call Screener',
    description: 'routing crying widows through to a host pitching birthstone rings',
  },
  {
    text: 'Peanut Sheller',
    description: 'hulling twenty thousand peanuts a shift for a regional candy jobber',
  },
  {
    text: 'Waterbed Salesman',
    description: 'demonstrating sloshing resistance to skeptical couples on the showroom floor',
  },
  {
    text: 'Roadside Motel Night Clerk',
    description: 'renting a single room to three different couples between midnight and 4am',
  },
  {
    text: 'State Fair Ferris Wheel Operator',
    description: "pulling the emergency stop four times a night 'for safety'",
  },
  {
    text: 'SuperStore Greeter Trainee',
    description: 'perfecting a waist-level wave and a single catchphrase',
  },
  {
    text: 'Warehouse Club Free-Sample Demonstrator',
    description: 'handing out chicken cubes on toothpicks and dodging eye contact',
  },
  {
    text: 'Coin Pusher Arcade Operator',
    description: 'watching quarters tumble onto other quarters and sweeping the drop-tray',
  },
  {
    text: 'Multi-Level Marketing Distributor',
    description: 'mailing out motivational cassettes to people who never asked',
  },
  {
    text: 'Lottery Ticket Printer Technician',
    description: 'reloading thermal paper rolls in three convenience stores every morning',
  },
  {
    text: 'Carpet Remnant Warehouse Assistant Manager',
    description: "price-gunning off-cuts into 'specialty bundles'",
  },
  {
    text: 'Sandwich Shop "Flavor Architect"',
    description: 'squirting mayonnaise in a single spiral on rye and calling it proprietary',
  },
  {
    text: 'Office Supply Plotter Specialist',
    description: 'tacking poster-sized banners with a T-square and too much confidence',
  },
  {
    text: 'Discount Shoe Store Floor Associate',
    description: "sizing up strangers' feet with a battered metal measuring device",
  },
  {
    text: 'Video Store Late Fee Collector',
    description: "leaving voicemails about a seventeen-day overdue kids' musical",
  },
  {
    text: 'Paintball Field Referee',
    description: "yelling 'paint check!' and getting shot on purpose once a Saturday",
  },
  {
    text: 'Go-Kart Track Mechanic',
    description: 'tuning the wobbliest kart to lose on purpose',
  },
  {
    text: "Mall Santa's Off-Season Understudy",
    description: 'keeping the beard in a labeled plastic bag from January to November',
  },
  {
    text: 'Apartment Complex Courtesy Patrol Officer',
    description: "radioing in 'suspicious activity' that turned out to be raccoons",
  },
  {
    text: 'Time-Share Presentation Facilitator',
    description: 'refilling a single watery pitcher of lemonade through ninety minutes of closing',
  },
  {
    text: 'Bail Bondsman Apprentice',
    description:
      'running one skip-trace and then hiding in the back room for the rest of the shift',
  },
  {
    text: 'Local Radio Morning Zoo Sidekick',
    description: 'cueing up bad sound effects at 6:47am to prompt laughter from the host',
  },
  {
    text: 'Plasticware Home-Party Regional Rep',
    description: 'convincing friends that airtight seals were a lifestyle',
  },
  {
    text: 'Meal-Replacement Shake Upline Consultant',
    description: 'shaking the shaker-bottle at their bewildered cousin over Thanksgiving',
  },
  {
    text: 'Pool Cleaner (one client, very rich)',
    description: 'skimming leaves off an Olympic-length pool twice a week and billing three times',
  },
  {
    text: 'Auto Glass Repair "Technician"',
    description: "filling star-breaks with clear epoxy and swearing 'you will never see it'",
  },
  {
    text: 'Newspaper Horoscope Columnist',
    description: 'recycling the same three Capricorn predictions on a four-week rotation',
  },
  {
    text: 'Satellite TV Door-to-Door Salesman',
    description: 'pitching six-year contracts to anyone who opened the screen door',
  },
  {
    text: 'Instant Messenger Support Hotline Operator',
    description: 'walking retirees through their away messages for minimum wage',
  },
  {
    text: 'Pawn Shop Jewelry Appraiser',
    description: 'lowballing grieving widows on gold chains for a wholesale turnaround',
  },
  {
    text: 'Frozen Yogurt Shop Owner (closed after six months)',
    description: 'topping cups with gummy worms until the lease quietly ran out',
  },
  {
    text: 'Stained Glass Window Apprentice',
    description: 'cutting themselves on the same piece of cobalt-blue glass thirty-two times',
  },
  {
    text: 'Budget Gym Towel Attendant',
    description: 'rolling towels into tight bundles while being pointedly ignored',
  },
  {
    text: 'Dollar Store Inventory Associate',
    description: 'pricing everything at a dollar except the things they decided cost $1.25',
  },
  {
    text: 'Ticket Reseller Phone Queue Supervisor',
    description: 'training interns to hold for three hours and still fail to secure seats',
  },
  {
    text: 'Mattress Warehouse Delivery Driver',
    description: 'wrestling a queen pillow-top up a three-flight walk-up',
  },
  {
    text: 'Small-Town Newspaper Obituary Writer',
    description: "phrasing 'brief illness' forty-seven different ways",
  },
  {
    text: 'Oil Change Quick-Lube Cashier',
    description: 'upselling cabin air filters to people who definitely did not need them',
  },
  {
    text: 'Pop-Up Spooky Store Seasonal Manager',
    description: 'reshelving rubber masks and finding a live rat inside the inflatable archway',
  },
  {
    text: 'Pretzel Kiosk Dough Twister',
    description: 'twisting knots all day and dreaming of a second career in real bread',
  },
  {
    text: 'Strip Mall Notary Public',
    description: "stamping divorce paperwork and asking 'would you like me to keep a copy'",
  },
  {
    text: 'Public Access Cable TV Host',
    description: 'interviewing the mayor on a set made of folding chairs and bedsheets',
  },
  {
    text: 'Cellular Phone Store Kiosk Rep',
    description: "pitching a 'free' flip phone that required a three-year contract",
  },
  {
    text: 'Supermarket Bag Boy (Twenty Years Running)',
    description: 'double-bagging the glass jars and correcting new baggers on egg placement',
  },
  {
    text: "Small-Town Mayor's Part-Time Aide",
    description:
      'updating a single bulletin board and fielding complaints about one specific pothole',
  },
  {
    text: 'Bait & Tackle Shop Weekend Clerk',
    description: 'counting nightcrawlers into styrofoam cups before dawn',
  },
  {
    text: 'Church Bulletin Designer',
    description: "centering the pastor's headshot and aligning the hymn numbers in WordArt",
  },
  {
    text: 'Off-Brand Theme Park Mascot',
    description: 'sweating through a velour cow suit for seventeen-dollar autographs',
  },
  {
    text: 'Mini-Golf Course Manager',
    description: 'fishing stuck balls out of the windmill with a coat hanger',
  },
  {
    text: 'Karaoke Night Host at a Dive Bar',
    description: "cueing up 'Sweet Caroline' for the fourth time in one shift",
  },
  {
    text: 'Community College Bookstore Cashier',
    description: 'shrink-wrapping textbooks nobody actually opened',
  },
  {
    text: 'Roller Rink DJ',
    description: 'ducking requests for the limbo song on infinite repeat',
  },
  {
    text: 'Elementary School Substitute Teacher',
    description: 'winging the lesson plan and bribing the class with twenty minutes of a VHS',
  },
  {
    text: 'Christmas Tree Lot Seasonal Employee',
    description: 'netting trees into impossibly compressed cylinders',
  },
  {
    text: 'Costume Shop Clerk',
    description: 'fogging the same pirate hat with the same can of spray starch',
  },
  {
    text: 'Self-Taught Web Designer (one terrible website)',
    description: 'centering GIF clouds on a blink tag and charging forty bucks',
  },
  {
    text: 'Realtor Yard-Sign Installer',
    description: 'staking corrugated plastic into frozen suburban lawns all winter',
  },
  {
    text: 'Pet Photographer at a Chain Portrait Studio',
    description: 'coaxing a cat to look at a plastic fish for seventeen consecutive frames',
  },
  {
    text: 'Night-Shift Vending Machine Refiller',
    description: 'restocking a fluorescent-lit rotation of taquitos and shelf-stable cheesecake',
  },
  {
    text: 'Mall Security Night Watchman',
    description: 'making one slow loop of a dead food court per hour',
  },
  {
    text: 'Carpet Sample Courier',
    description: 'lugging a duffel of sample squares between three showrooms',
  },
  {
    text: 'Funeral Procession Lead Car Driver',
    description: 'maintaining twelve miles per hour down Main Street in a borrowed town car',
  },
  {
    text: 'Wedding Cake Delivery Boy',
    description: 'balancing a three-tier buttercream job in the backseat of a hatchback',
  },
  {
    text: 'Paperback Book Club Mailer',
    description: 'addressing envelopes for a subscription nobody remembered signing up for',
  },
  {
    text: 'Pharmacy Photo Lab Developer',
    description: "seeing things they were not supposed to see on other people's film",
  },
  {
    text: 'Coupon Book Door-to-Door Solicitor',
    description: 'explaining a nine-dollar coupon pamphlet on every porch in three counties',
  },
  {
    text: 'Renaissance Faire Turkey-Leg Vendor',
    description: "shouting 'Huzzah!' and handing over a five-dollar drumstick",
  },
  {
    text: 'Timeshare Telemarketer',
    description: "cold-dialing retirees about a five-night 'discovery weekend' in a swamp",
  },
  {
    text: 'Adult Ed Night-Class Instructor',
    description: 'teaching spreadsheets to adults who only signed up for the parking validation',
  },
  {
    text: 'Scratch-Off Ticket Quality Inspector',
    description: 'confirming the latex coating was thick enough for six more dollars of hope',
  },
  {
    text: 'Amateur Ghost Hunter (zero confirmed findings)',
    description: 'hauling a bag of bargain-bin EMF readers into attics nobody asked about',
  },
  {
    text: 'Garden Center Seasonal Plant Waterer',
    description: 'drowning petunias for fourteen dollars an hour',
  },
  {
    text: 'Bounce House Weekend Operator',
    description: 'refereeing sock-footed seven-year-olds for eight hours of screaming',
  },
  {
    text: 'Bagel Shop Opening-Shift Slicer',
    description: 'losing fingertip sensitivity to a poorly adjusted bagel-slicer at 4:30am',
  },
  {
    text: 'Laser Tag Arena Party Host',
    description: "shouting 'NO RUNNING' at ten-year-olds through a fogged-up visor",
  },
  {
    text: 'Pizza Parlor Delivery Driver (three moving violations)',
    description: 'rolling stop signs with a heat bag of cooling pepperoni',
  },
  {
    text: 'Auto-Detail Shop Vacuum Technician',
    description: 'finding loose change in seventeen minivans per shift',
  },
  {
    text: 'Fireworks Stand Seasonal Manager',
    description: 'losing an eyebrow at least twice before the holiday weekend',
  },
  {
    text: 'Flea Market Booth Flipper',
    description: 'buying collectibles by the sack and reselling them individually',
  },
  {
    text: 'Tennis Ball Retriever at a Country Club',
    description: 'scurrying after fuzzy yellow spheres while members ignored them completely',
  },
  {
    text: 'Waterpark Wave-Pool Lifeguard',
    description:
      'blowing a whistle at splashing six-year-olds and scanning the horizon for real danger',
  },
  {
    text: 'Sentimental Greeting Card Rhymer',
    description: "making 'nephew' and 'new shoe' rhyme for the quarterly catalogue",
  },
  {
    text: 'Roadside Billboard Paste-Up Artist',
    description: 'wheat-pasting a smiling realtor onto twelve feet of plywood',
  },
  {
    text: 'Apartment Leasing Office Weekend Rep',
    description: 'doling out a single branded pen and a clipboard to every walk-in',
  },
  {
    text: 'Sub Shop "Crust Curator"',
    description: 'scoring loaves in a specific pattern only they understood the significance of',
  },
  {
    text: 'Neighborhood Pool Chlorine Guy',
    description:
      'dumping granules into the deep end and vanishing before anyone could ask questions',
  },
  {
    text: 'Grocery Cart Wrangler',
    description:
      'chaining eight carts together and steering them through a parking-lot thunderstorm',
  },

  {
    text: 'Y2K Security Analyst at a Defense Contractor',
    description:
      'auditing mainframes for two-digit year bugs right up until midnight on December 31',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Y2K Bug Remediation Consultant',
    description: 'billing governments hourly to not restart the airline reservation system',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Overworked Resident at a County Hospital',
    description: 'pulling ninety-hour weeks and still losing an intern in the cafeteria',
    titles: ['Dr.'],
  },
  {
    text: 'Tenure-Track Poultry Geneticist',
    description: 'selectively breeding quail for a federal grant nobody renewed',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Community College Chem 101 Adjunct',
    description: 'balancing equations on a whiteboard that had not been erased in a decade',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Dot-Com VP of Thought Leadership',
    description: 'flying coach to industry panels and leaving with one lukewarm business card',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Strip Mall Podiatrist',
    description: 'cleaning ingrown toenails between a nail salon and a taekwondo studio',
    titles: ['Dr.'],
  },
  {
    text: 'Veterinarian (horses only, very specific)',
    description:
      'driving a converted van between three rural stables with one mostly-clean stethoscope',
    titles: ['Dr.'],
  },
  {
    text: 'Author of an Unread Computer Science Textbook',
    description: 'charging $148 for a second edition that corrected a single typo on page 412',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: "Dean's List Tutor-for-Hire",
    description: 'charging thirty bucks an hour to walk freshmen through limits and derivatives',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Think-Tank Night-Shift Researcher',
    description: 'writing op-eds at 2am that every editor in three counties would then ignore',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Failed Philosophy PhD Turned Barista',
    description: 'explaining the ontological status of almond milk to the 8am rush',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Chiropractor with Questionable Credentials',
    description:
      'cracking spines in a strip-mall suite on a rope-and-pulley table of their own design',
    titles: ['Dr.'],
  },
  {
    text: 'Corporate Efficiency Black Belt Trainer',
    description: 'facilitating two-day offsites about synergies in hotel conference room B',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Ophthalmologist (sunglasses hustle on the side)',
    description: 'writing eyedrop prescriptions and pushing an in-house shades brand',
    titles: ['Dr.'],
  },
  {
    text: 'Patent Clerk in a Dying Downtown Office',
    description: "stamping 'pending' on file folders for twenty-six consecutive years",
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Adjunct Folklore Lecturer',
    description: 'delivering the same lecture on regional ghost stories to empty chairs every fall',
    titles: ['Prof.'],
  },
  {
    text: 'Professor Emeritus of Bovine Studies',
    description:
      'publishing the third edition of their definitive cow-behavior textbook to polite applause',
    titles: ['Prof.'],
  },
  {
    text: 'Actuary at a Small-Town Insurance Firm',
    description: "producing mortality tables in a windowless office above a dentist's practice",
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Veterinary Pharmacist',
    description: "dispensing heartworm chews to dogs with people's names",
    titles: ['Dr.'],
  },
  {
    text: 'Methodologist at a Market Research Boutique',
    description: "designing surveys that asked 'on a scale of 1 to 7' about dish soap",
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Optometrist in a Retail Chain Storefront',
    description: 'fitting bifocals inside a mall in forty-five minutes or less',
    titles: ['Dr.'],
  },
  {
    text: 'ABD Dissertation Writer (twelve years running)',
    description: 'still polishing chapter two of a dissertation the committee gave up on',
    titles: ['Prof.'],
  },
  {
    text: 'Dental Hygienist with Strong Opinions',
    description:
      'lecturing clients about flossing and bullying the front-desk about waiting-room playlists',
    titles: ['Dr.'],
  },
  {
    text: 'Pediatric Nurse Practitioner at a Rural Clinic',
    description: 'distributing stickers and lollipops between ear infections',
    titles: ['Dr.'],
  },
  {
    text: 'Associate Lecturer in Medieval Metallurgy',
    description: 'forging a chainmail coif in the faculty parking lot on weekends',
    titles: ['Prof.'],
  },
  {
    text: 'Orthodontist with a Minivan',
    description: 'tightening braces on middle-schoolers every other Thursday',
    titles: ['Dr.'],
  },
  {
    text: 'Bioinformatics Contractor',
    description: 'writing Perl scripts that genome labs would never read past line eight',
    titles: ['Dr.', 'Prof.'],
  },
  {
    text: 'Substitute Adjunct for Whatever Class Opens Up',
    description: 'teaching intro comp, intro econ, and intro philosophy in the same week',
    titles: ['Prof.'],
  },
  {
    text: 'Low-Budget Clinical Trial Coordinator',
    description: 'handing $75 cash to anyone who would swallow a pill in a strip-mall office',
    titles: ['Dr.'],
  },

  {
    text: 'Retired from a Domestic Base',
    description: 'mowing the lawn in a reflective vest and addressing the mailman as "son"',
    titles: ['Col.'],
  },
  {
    text: 'Private Military Contractor',
    description:
      "working three-month rotations in a 'security consulting' capacity nobody could define",
    titles: ['Col.'],
  },
  {
    text: 'Desert Campaign Veteran (now drives a tiny convertible)',
    description: 'white-knuckling the steering wheel at every off-ramp merge',
    titles: ['Col.'],
  },
  {
    text: 'Cadet Corps Instructor at a State University',
    description: 'drilling undergraduates on the parade grounds at 6am every Thursday',
    titles: ['Col.'],
  },
  {
    text: 'Military Surplus Store Owner',
    description: 'pricing decommissioned radio equipment just below the online comps',
    titles: ['Col.'],
  },
  {
    text: 'Survivalist Newsletter Publisher',
    description: 'mimeographing a 24-page booklet about freeze-dried beef stroganoff',
    titles: ['Col.'],
  },
  {
    text: 'Defense Bureaucracy Paper Pusher',
    description: 'routing expense memos between three offices until someone finally signed',
    titles: ['Col.'],
  },
  {
    text: 'Decorated Foreign-War Veteran (questions this himself)',
    description: 'accepting the discount pie at the diner and wondering if he deserved it',
    titles: ['Col.'],
  },
  {
    text: 'Ex-Commando, Runs a Tuesday Bowling League',
    description: 'teaching middle-aged men to keep their wrists straight on the approach',
    titles: ['Col.'],
  },
  {
    text: 'Airborne Scout Reservist',
    description: 'jumping out of perfectly good aircraft one weekend a month',
    titles: ['Col.'],
  },
  {
    text: 'Veterans Hall President',
    description: 'running the Tuesday bingo and refereeing potato salad at the summer picnic',
    titles: ['Col.'],
  },
  {
    text: 'Private Security Consultant (bodyguard to a minor pop star)',
    description: 'blocking 4am paparazzi from the lobby of a roadside motel',
    titles: ['Col.'],
  },
  {
    text: 'Home Guard Recruiter',
    description: 'handing out pens and foam koozies at high-school career fairs',
    titles: ['Col.'],
  },
  {
    text: 'Ex-Drill Sergeant Running a Boot-Camp-Themed Gym',
    description: "shouting 'DROP AND GIVE ME TWENTY' at a 48-year-old accountant in yoga pants",
    titles: ['Col.'],
  },
  {
    text: 'Submarine Cook (Honorable Discharge)',
    description: 'making a single pot of chili feed 140 sailors for two consecutive days',
    titles: ['Col.'],
  },
  {
    text: 'Air Base Control Tower Operator',
    description: 'reading headings to the same four pilots on the same daily circuit',
    titles: ['Col.'],
  },
];

/**
 * @param {BackstoryEntry[]} pool
 * @returns {{ generic: string[], specific: Map<string, string[]> }}
 */
function partition(pool) {
  const generic = [];
  /** @type {Map<string, string[]>} */
  const specific = new Map();
  for (const e of pool) {
    if (!e.titles) {
      generic.push(e.text);
      continue;
    }
    for (const t of e.titles) {
      let arr = specific.get(t);
      if (!arr) {
        arr = [];
        specific.set(t, arr);
      }
      arr.push(e.text);
    }
  }
  return { generic, specific };
}

const CHILDHOOD_POOLS = partition(CHILDHOODS);
const PROFESSION_POOLS = partition(PROFESSIONS);

/**
 * Reverse lookup: profession text → gerund description. Populated from the
 * same pool so a rename in one place updates both the roll and the tooltip.
 * Returns null for old-save profession strings that no longer match (the UI
 * falls back to showing just the title line without a hover).
 *
 * @type {Map<string, string>}
 */
const PROFESSION_DESCRIPTIONS = new Map();
for (const p of PROFESSIONS) PROFESSION_DESCRIPTIONS.set(p.text, p.description);

/**
 * @param {string} profession
 * @returns {string | null}
 */
export function getProfessionDescription(profession) {
  return PROFESSION_DESCRIPTIONS.get(profession) ?? null;
}

/**
 * @param {{ generic: string[], specific: Map<string, string[]> }} pools
 * @param {string} title
 * @param {() => number} rng
 */
function pickFrom(pools, title, rng) {
  const specific = pools.specific.get(title);
  if (specific && rng() < TITLE_MATCH_CHANCE) {
    return specific[Math.floor(rng() * specific.length)];
  }
  return pools.generic[Math.floor(rng() * pools.generic.length)];
}

/**
 * @param {string} title
 * @param {() => number} [rng]
 */
export function pickChildhood(title, rng = Math.random) {
  return pickFrom(CHILDHOOD_POOLS, title, rng);
}

/**
 * @param {string} title
 * @param {() => number} [rng]
 */
export function pickProfession(title, rng = Math.random) {
  return pickFrom(PROFESSION_POOLS, title, rng);
}
