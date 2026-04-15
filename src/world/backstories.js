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
 */

const TITLE_MATCH_CHANCE = 0.7;

/**
 * @typedef BackstoryEntry
 * @property {string} text
 * @property {string[]} [titles]  if present, only cows with these titles roll this entry
 */

/** @type {BackstoryEntry[]} */
const CHILDHOODS = [
  { text: 'raised on a dairy farm' },
  { text: 'latchkey kid with a Tamagotchi collection' },
  { text: 'suburban cul-de-sac rat' },
  { text: 'spent every summer at bible camp' },
  { text: 'collected Pogs, lost them all in a slammer tournament' },
  { text: 'homeschooled by conspiracy theorists' },
  { text: 'mowed lawns all summer for saxophone money' },
  { text: 'lived above a family-owned pizzeria' },
  { text: 'ran a newspaper route on a hand-me-down BMX' },
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
  { text: 'raised by a single mom who sold Avon door-to-door' },
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
  { text: 'got a perfect SAT and has mentioned it every year since', titles: ['Dr.', 'Prof.'] },
  { text: 'interned at a research lab at fourteen', titles: ['Dr.', 'Prof.'] },
  { text: 'youngest Quiz Bowl captain their high school ever had', titles: ['Dr.', 'Prof.'] },
  { text: 'skipped prom for an astronomy conference', titles: ['Dr.', 'Prof.'] },
  { text: 'home-built a Linux box in the garage at age twelve', titles: ['Dr.', 'Prof.'] },
  { text: 'tutored every one of their younger siblings through algebra', titles: ['Dr.', 'Prof.'] },
  { text: 'skipped recess daily for extra credit', titles: ['Dr.', 'Prof.'] },
  { text: 'spent two summers at a model UN camp', titles: ['Dr.', 'Prof.'] },

  { text: 'only-child army brat who moved every two years', titles: ['Col.'] },
  { text: 'joined JROTC in seventh grade', titles: ['Col.'] },
  { text: 'Eagle Scout at thirteen', titles: ['Col.'] },
  { text: 'grew up on a Nevada air base', titles: ['Col.'] },
  { text: 'shipped to military school after the fireworks incident', titles: ['Col.'] },
  { text: 'ran a paintball league on the weekends', titles: ['Col.'] },
  { text: 'was the youngest kid at the shooting range every weekend', titles: ['Col.'] },
  { text: 'spent every summer in cadet corps', titles: ['Col.'] },
];

/** @type {BackstoryEntry[]} */
const PROFESSIONS = [
  { text: 'Used Tire Salesman' },
  { text: 'Video Rental Assistant Manager' },
  { text: 'Big Box Electronics Sales Associate' },
  { text: 'Electronics Store Battery Specialist' },
  { text: 'Dial-Up ISP Customer Retention Rep' },
  { text: 'DMV Window #3 Clerk' },
  { text: 'Suburban Realtor (two luxury sedans)' },
  { text: 'Collectible Plushie Authenticator' },
  { text: 'IT Helpdesk Intern' },
  { text: 'Mall Kiosk Ear-Piercing Technician' },
  { text: 'Hotel Continental Breakfast Attendant' },
  { text: 'Goth Mall Store Assistant Manager' },
  { text: 'Chain Restaurant Flair Specialist' },
  { text: 'Dot-Com Startup Foosball Coordinator' },
  { text: 'Bowling Alley Shoe Sprayer' },
  { text: 'Used Car Lot Balloon Wrangler' },
  { text: 'Strip Mall Tanning Salon Owner' },
  { text: 'Cable Company Installation Technician' },
  { text: 'SuperStore Layaway Clerk' },
  { text: 'Pager Company Regional Sales Rep' },
  { text: 'Junior Accountant at a Disgraced Energy Firm' },
  { text: 'Funeral Home Makeup Artist' },
  { text: 'Print Shop Supervisor' },
  { text: 'Gas Station Attendant (scratch-off specialist)' },
  { text: 'Long-Distance Phone Card Reseller' },
  { text: 'Pyramid Scheme Upline (silver tier)' },
  { text: 'Local News Weekend Weather Guy' },
  { text: 'Trucking Dispatch Night Shift' },
  { text: 'Self-published Poet (sold 40 copies)' },
  { text: 'Pet Store Tarantula Specialist' },
  { text: 'Copier Repair Tech' },
  { text: 'Wedding DJ (one speaker blown)' },
  { text: 'Drive-Thru Coffee Stand Operator' },
  { text: 'Quick-Lube Middle Bay Technician' },
  { text: 'Funnel Cake Cart Owner' },
  { text: 'Stadium Hot Dog Vendor' },
  { text: 'Home Shopping Channel Call Screener' },
  { text: 'Unemployed, but in a cool way' },
  { text: 'Peanut Sheller' },
  { text: 'Waterbed Salesman' },
  { text: 'Roadside Motel Night Clerk' },
  { text: 'State Fair Ferris Wheel Operator' },
  { text: 'SuperStore Greeter Trainee' },
  { text: 'Warehouse Club Free-Sample Demonstrator' },
  { text: 'Coin Pusher Arcade Operator' },
  { text: 'Multi-Level Marketing Distributor' },
  { text: 'Lottery Ticket Printer Technician' },
  { text: 'Carpet Remnant Warehouse Assistant Manager' },
  { text: 'Sandwich Shop "Sandwich Artist"' },
  { text: 'Office Supply Plotter Specialist' },
  { text: 'Discount Shoe Store Floor Associate' },
  { text: 'Video Store Late Fee Collector' },
  { text: 'Paintball Field Referee' },
  { text: 'Go-Kart Track Mechanic' },
  { text: 'Mall Santa’s Off-Season Understudy' },
  { text: 'Apartment Complex Courtesy Patrol Officer' },
  { text: 'Time-Share Presentation Facilitator' },
  { text: 'Bail Bondsman Apprentice' },
  { text: 'Local Radio Morning Zoo Sidekick' },
  { text: 'Plasticware Home-Party Regional Rep' },
  { text: 'Meal-Replacement Shake Upline Consultant' },
  { text: 'Pool Cleaner (one client, very rich)' },
  { text: 'Auto Glass Repair "Technician"' },
  { text: 'Newspaper Horoscope Columnist' },
  { text: 'Satellite TV Door-to-Door Salesman' },
  { text: 'Instant Messenger Support Hotline Operator' },
  { text: 'Pawn Shop Jewelry Appraiser' },
  { text: 'Frozen Yogurt Shop Owner (closed after six months)' },
  { text: 'Stained Glass Window Apprentice' },
  { text: 'Budget Gym Towel Attendant' },
  { text: 'Dollar Store Inventory Associate' },
  { text: 'Ticket Reseller Phone Queue Supervisor' },
  { text: 'Mattress Warehouse Delivery Driver' },
  { text: 'Small-Town Newspaper Obituary Writer' },
  { text: 'Oil Change Quick-Lube Cashier' },
  { text: 'Pop-Up Halloween Store Seasonal Manager' },
  { text: 'Pretzel Kiosk Dough Twister' },
  { text: 'Strip Mall Notary Public' },
  { text: 'Public Access Cable TV Host' },
  { text: 'Cellular Phone Store Kiosk Rep' },
  { text: 'Supermarket Bag Boy (Twenty Years Running)' },
  { text: 'Small-Town Mayor’s Part-Time Aide' },
  { text: 'Bait & Tackle Shop Weekend Clerk' },
  { text: 'Church Bulletin Designer' },
  { text: 'Off-Brand Theme Park Mascot' },
  { text: 'Mini-Golf Course Manager' },
  { text: 'Karaoke Night Host at a Dive Bar' },
  { text: 'Community College Bookstore Cashier' },
  { text: 'Roller Rink DJ' },
  { text: 'Elementary School Substitute Teacher' },
  { text: 'Christmas Tree Lot Seasonal Employee' },
  { text: 'Costume Shop Clerk' },
  { text: 'Self-Taught Web Designer (one terrible website)' },
  { text: 'Realtor Yard-Sign Installer' },
  { text: 'Pet Photographer at a Chain Portrait Studio' },
  { text: 'Night-Shift Vending Machine Refiller' },
  { text: 'Mall Security Night Watchman' },
  { text: 'Carpet Sample Courier' },
  { text: 'Funeral Procession Lead Car Driver' },
  { text: 'Wedding Cake Delivery Boy' },
  { text: 'Paperback Book Club Mailer' },
  { text: 'Pharmacy Photo Lab Developer' },
  { text: 'Coupon Book Door-to-Door Solicitor' },
  { text: 'Renaissance Faire Turkey-Leg Vendor' },
  { text: 'Timeshare Telemarketer' },
  { text: 'Adult Ed Night-Class Instructor' },
  { text: 'Scratch-Off Ticket Quality Inspector' },
  { text: 'Amateur Ghost Hunter (zero confirmed findings)' },
  { text: 'Garden Center Seasonal Plant Waterer' },
  { text: 'Bounce House Weekend Operator' },
  { text: 'Bagel Shop Opening-Shift Slicer' },
  { text: 'Laser Tag Arena Party Host' },
  { text: 'Pizza Parlor Delivery Driver (three moving violations)' },
  { text: 'Auto-Detail Shop Vacuum Technician' },
  { text: 'Fireworks Stand Seasonal Manager' },
  { text: 'Flea Market Booth Flipper' },
  { text: 'Tennis Ball Retriever at a Country Club' },
  { text: 'Waterpark Wave-Pool Lifeguard' },
  { text: 'Hallmark-Style Greeting Card Rhymer' },
  { text: 'Roadside Billboard Paste-Up Artist' },
  { text: 'Apartment Leasing Office Weekend Rep' },
  { text: 'Sub Shop "Bread Artisan"' },
  { text: 'Neighborhood Pool Chlorine Guy' },
  { text: 'Grocery Cart Wrangler' },

  { text: 'Y2K Security Analyst at a Defense Contractor', titles: ['Dr.', 'Prof.'] },
  { text: 'Y2K Bug Remediation Consultant', titles: ['Dr.', 'Prof.'] },
  { text: 'Overworked Resident at a County Hospital', titles: ['Dr.'] },
  { text: 'Tenure-Track Poultry Geneticist', titles: ['Dr.', 'Prof.'] },
  { text: 'Community College Chem 101 Adjunct', titles: ['Dr.', 'Prof.'] },
  { text: 'Dot-Com VP of Thought Leadership', titles: ['Dr.', 'Prof.'] },
  { text: 'Strip Mall Podiatrist', titles: ['Dr.'] },
  { text: 'Veterinarian (horses only, very specific)', titles: ['Dr.'] },
  { text: 'Author of an Unread Computer Science Textbook', titles: ['Dr.', 'Prof.'] },
  { text: 'Dean’s List Tutor-for-Hire', titles: ['Dr.', 'Prof.'] },
  { text: 'Think-Tank Night-Shift Researcher', titles: ['Dr.', 'Prof.'] },
  { text: 'Failed Philosophy PhD Turned Barista', titles: ['Dr.', 'Prof.'] },
  { text: 'Chiropractor with Questionable Credentials', titles: ['Dr.'] },
  { text: 'Six Sigma Black Belt Corporate Trainer', titles: ['Dr.', 'Prof.'] },
  { text: 'Ophthalmologist (sunglasses hustle on the side)', titles: ['Dr.'] },
  { text: 'Patent Clerk in a Dying Downtown Office', titles: ['Dr.', 'Prof.'] },
  { text: 'Adjunct Folklore Lecturer', titles: ['Prof.'] },
  { text: 'Professor Emeritus of Bovine Studies', titles: ['Prof.'] },
  { text: 'Actuary at a Small Ohio Insurance Firm', titles: ['Dr.', 'Prof.'] },
  { text: 'Veterinary Pharmacist', titles: ['Dr.'] },
  { text: 'Methodologist at a Market Research Boutique', titles: ['Dr.', 'Prof.'] },
  { text: 'Optometrist in a Retail Chain Storefront', titles: ['Dr.'] },
  { text: 'ABD Dissertation Writer (twelve years running)', titles: ['Prof.'] },
  { text: 'Dental Hygienist with Strong Opinions', titles: ['Dr.'] },
  { text: 'Pediatric Nurse Practitioner at a Rural Clinic', titles: ['Dr.'] },
  { text: 'Associate Lecturer in Medieval Metallurgy', titles: ['Prof.'] },
  { text: 'Orthodontist with a Minivan', titles: ['Dr.'] },
  { text: 'Bioinformatics Contractor', titles: ['Dr.', 'Prof.'] },
  { text: 'Substitute Adjunct for Whatever Class Opens Up', titles: ['Prof.'] },
  { text: 'Low-Budget Clinical Trial Coordinator', titles: ['Dr.'] },

  { text: 'Retired from a Stateside Base', titles: ['Col.'] },
  { text: 'Private Military Contractor', titles: ['Col.'] },
  { text: 'Desert Storm Veteran (now drives a tiny convertible)', titles: ['Col.'] },
  { text: 'ROTC Instructor at a State University', titles: ['Col.'] },
  { text: 'Military Surplus Store Owner', titles: ['Col.'] },
  { text: 'Survivalist Newsletter Publisher', titles: ['Col.'] },
  { text: 'Pentagon Paper Pusher', titles: ['Col.'] },
  { text: 'Decorated Korean War Veteran (questions this himself)', titles: ['Col.'] },
  { text: 'Ex-Marine, Runs a Tuesday Bowling League', titles: ['Col.'] },
  { text: 'Airborne Ranger Reservist', titles: ['Col.'] },
  { text: 'VFW Hall President', titles: ['Col.'] },
  { text: 'Private Security Consultant (bodyguard to a minor pop star)', titles: ['Col.'] },
  { text: 'National Guard Recruiter', titles: ['Col.'] },
  { text: 'Ex-Drill Sergeant Running a Boot-Camp-Themed Gym', titles: ['Col.'] },
  { text: 'Submarine Cook (Honorable Discharge)', titles: ['Col.'] },
  { text: 'Air Base Control Tower Operator', titles: ['Col.'] },
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
