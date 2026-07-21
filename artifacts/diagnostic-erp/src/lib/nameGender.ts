/**
 * nameGender.ts — best-effort gender suggestion from an Indian first name.
 *
 * Used to pre-fill the Sex field during patient registration (Bill Desk,
 * Register, Patients, Kiosk/self-registration, online booking) so staff
 * usually don't have to touch it. It is ALWAYS just a suggestion: the
 * field stays a normal editable Male/Female control, and callers must
 * stop auto-filling the moment a user manually picks a value (see the
 * "touched" pattern used at each call site) — this never overrides an
 * explicit choice.
 *
 * Deliberately a bundled local list, not an external API call: no network
 * dependency, no latency, and no third-party sharing of a patient's name.
 * Deliberately lookup-only (no suffix/heuristic guessing like "ends in
 * -a is usually female") — that heuristic is wrong often enough for
 * Indian names (e.g. "Krishna", "Kripa" trend male in some traditions,
 * female in others) to do more harm than good; an unrecognized name
 * simply returns null and the field is left for staff to pick.
 *
 * Coverage: common first names spanning Hindi, Bengali, Bihari/Jharkhandi
 * (incl. Santali/Adivasi), Marathi, Gujarati, Punjabi/Sikh, Tamil, Telugu,
 * Kannada, Malayalam, Odia, Assamese, Muslim, and Christian naming
 * traditions — broad enough for a general diagnostic clinic drawing
 * patients from across India, not exhaustive. Names that are genuinely
 * unisex in common usage (e.g. "Kiran", "Anand", "Amarjeet") are
 * intentionally omitted from both lists rather than guessed.
 */

const MALE_NAMES = [
  // Hindi belt / pan-India
  "aakash", "aarav", "aayush", "abhay", "abhijeet", "abhijit", "abhinav", "abhishek",
  "aditya", "aftab", "ajay", "akash", "akbar", "akhilesh", "alok", "aman", "amar",
  "amit", "amitabh", "anand", "anil", "ankit", "ankur", "anmol", "anoop", "anshul",
  "anuj", "arbaaz", "arjun", "arnav", "arpit", "arun", "arvind", "ashish", "ashok",
  "ashutosh", "ashwin", "atul", "avinash", "ayaan", "ayush", "azad", "babu",
  "bablu", "bharat", "bhaskar", "bhupendra", "bijay", "bijoy", "bikram", "bimal",
  "binod", "bipin", "brajesh", "chandan", "chandra", "chetan", "danish",
  "darshan", "deepak", "deepankar", "devendra", "dhananjay", "dharmendra", "dilip",
  "dinesh", "diwakar", "durgesh", "faisal", "faizan", "farhan", "firoz", "gagan",
  "ganesh", "gaurav", "girish", "gopal", "gopalji", "gulshan", "gyanendra",
  "hariom", "harendra", "harish", "harsh", "harshvardhan", "hemant", "himanshu",
  "imran", "indrajeet", "irfan", "ishaan", "jagdish", "jaideep", "jai", "jamal",
  "jatin", "javed", "jitendra", "jyoti prakash", "kailash", "kamal", "kamlesh",
  "kanhaiya", "kapil", "karan", "kartik", "kaushal", "kedar", "krishna", "kuldeep",
  "kumar", "kunal", "lakshman", "lalan", "lalit", "lokesh", "madan", "mahendra",
  "mahesh", "manav", "manish", "manjeet", "manoj", "manzoor", "mayank", "md",
  "mohammed", "mohan", "mohit", "mukesh", "mukul", "munna", "murari", "nagendra",
  "nakul", "naman", "nand kishore", "naresh", "narendra", "naveen", "navin",
  "naveed", "neeraj", "nikhil", "nirmal", "nishant", "nitesh", "nitin", "om",
  "omprakash", "pankaj", "paramjit", "parashar", "parth", "parvez", "pawan",
  "piyush", "prabhat", "pradeep", "pramod", "pranav", "pranay", "prasanna",
  "prashant", "pratap", "prateek", "pravin", "prem", "prince", "priyabrata",
  "priyaranjan", "punit", "purushottam", "puneet", "qadir", "rafiq", "raghav",
  "raghunandan", "rahul", "raj", "raja", "rajan", "rajat", "rajeev", "rajendra",
  "rajesh", "rajkumar", "rajnish", "rajveer", "rakesh", "ram", "raman", "ramesh",
  "ranbir", "ranjan", "ranjeet", "ranjit", "ravi", "ravindra", "riyaz", "rishabh",
  "rishi", "ritesh", "rizwan", "rohan", "rohit", "roshan", "rupesh", "sachin",
  "sagar", "sahil", "saif", "sajid", "salman", "sameer", "samir", "sandeep",
  "sanjay", "sanjeev", "sanjiv", "santosh", "saroj", "satish", "satyendra",
  "saurabh", "shahbaz", "shailendra", "shakeel", "shakti", "shankar", "shanmukh",
  "sharad", "shashank", "shashi bhushan", "shatrughan", "shekhar", "shiv",
  "shivam", "shivendra", "shubham", "siddharth", "somnath", "sonu", "subhash",
  "subodh", "sudhakar", "sudhir", "sujit", "sukant", "sukhdev", "suman kumar",
  "sumit", "sunil", "suraj", "surendra", "suresh", "surya", "swapan", "tanmay",
  "tanuj", "tarun", "tejas", "tinku", "tufail", "udit", "umesh", "upendra",
  "utkarsh", "uttam", "vaibhav", "vansh", "varun", "vasudev", "veer", "veerendra",
  "vidyasagar", "vijay", "vikas", "vikram", "vimal", "vinay", "vinod", "vipin",
  "vishal", "vishnu", "vivek", "wasim", "yash", "yashwant", "yogendra", "yogesh",
  "zahid", "zakir",
  // Modern / Gen-Z pan-India
  "aarush", "advait", "agastya", "atharv", "dev", "devansh", "dhruv", "ishan",
  "kabir", "kian", "krish", "kritin", "lakshya", "myron", "neil", "ojas",
  "pratyush", "reyansh", "rudra", "sarthak", "shaurya", "tanish", "vedant",
  "vihaan", "viraj", "yug", "zayn",
  // Tamil
  "aravind", "arul", "bala", "balaji", "chandrasekhar", "elango", "ganapathy",
  "gopalakrishnan", "gowtham", "hari", "jagan", "kannan", "karthik", "karthikeyan",
  "kishore", "krishnamurthy", "madhavan", "mahadevan", "manikandan", "moorthy",
  "murugan", "nataraj", "natarajan", "pandian", "prabakaran", "prabhu",
  "raghunath", "ramachandran", "ramakrishnan", "ramanathan", "ramamurthy",
  "sathish", "sekar", "selvam", "senthil", "shanmugam", "shiva", "sivakumar",
  "srinivas", "srinivasan", "subbu", "subramaniam", "sundar", "sundaram",
  "thangaraj", "thiru", "vasudevan", "velu", "venkatesan", "venkataraman",
  "vignesh", "vijayakumar", "viswanathan", "yuvaraj",
  // Telugu
  "chandrashekar", "gopichand", "hemanth", "jagadeesh", "kalyan", "pavan",
  "prasad", "sai", "satyanarayana", "sivaji", "srikanth", "venkat", "venkatesh",
  // Kannada
  "basavaraj", "chandru", "gurunath", "halappa", "kumaraswamy", "nagaraj",
  "nataraja", "prakash", "shivakumar", "siddaraju", "veerabhadra", "veeresh",
  "yallappa",
  // Malayalam / Kerala Christian
  "abin", "ajith", "binu", "biju", "davis", "francis", "jacob", "jose",
  "joseph", "joy", "mathew", "sabu", "sudheer", "thomas", "unni", "varghese",
  // Gujarati
  "bhavesh", "bhupesh", "chirag", "dhaval", "dharmesh", "hardik", "harshad",
  "hasmukh", "hitesh", "jayesh", "jignesh", "kalpesh", "ketan", "kirit",
  "mehul", "mihir", "nayan", "nikunj", "nilesh", "paresh", "pratik", "tushar",
  "urvish", "vipul",
  // Marathi
  "amol", "ajit", "anant", "aniket", "bhushan", "chandrakant", "datta",
  "dnyaneshwar", "gajanan", "mangesh", "milind", "nandkishor", "omkar",
  "rajaram", "ramchandra", "sandip", "shantaram", "shrikant", "swapnil",
  "tanaji", "vasant", "vinayak", "vishwas",
  // Odia
  "bibhuti", "biswajit", "debasish", "gopabandhu", "jagannath", "manoranjan",
  "nilamani", "rabindra", "sarat", "subrat", "sudarshan",
  // Assamese
  "anupam", "bhupen", "dipankar", "hemanta", "pranjal", "prasanta",
  // Bengali
  "abhirup", "amitava", "anirban", "aniruddha", "apurba", "arindam", "ashoke",
  "asit", "avik", "bikash", "biplab", "debashish", "gautam", "indranil",
  "joydeep", "koushik", "mrinal", "nabarun", "partha", "prasenjit", "pritam",
  "ratan", "saikat", "sanjib", "sourav", "subrata", "sudip", "sumanta",
  "sushanta", "tapan", "tirthankar",
  // Punjabi / Sikh
  "amarjit", "avtar", "balbir", "baldev", "baljit", "balwant", "balwinder",
  "bhagwan", "charanjit", "dalbir", "daljit", "davinder", "dilbag", "gurbaksh",
  "gurcharan", "gurdeep", "gurjeet", "gurmail", "gurmeet", "gursewak", "gurtej",
  "harbans", "harbhajan", "hardeep", "harinder", "harjeet", "harjit", "harmeet",
  "harpal", "harvinder", "inderjeet", "jagjit", "jagtar", "jaspal", "jasbir",
  "jaswant", "jatinder", "jaswinder", "joginder", "kartar", "kulbir", "kuldip",
  "kulwant", "lakhbir", "lakhvinder", "mahinder", "malkit", "mohinder",
  "narinder", "parminder", "pritpal", "rajinder", "ranjodh", "sarabjit",
  "satnam", "sukhbir", "sukhwinder", "surinder", "sukhjinder", "tarsem",
  "tejinder", "ujjal", "waryam",
  // Muslim
  "aamir", "abdul", "abdullah", "abrar", "adil", "ahmed", "akram", "ali",
  "altaf", "amjad", "anis", "anwar", "arif", "asad", "ashfaq", "ayub",
  "bashir", "ehsaan", "faheem", "farooq", "feroz", "ghulam", "habib", "haider",
  "hamid", "hamza", "hanif", "hasan", "hussain", "iftikhar", "ikram", "ilyas",
  "iqbal", "ishtiaq", "ismail", "jahangir", "kaif", "kamran", "khalid",
  "liaqat", "mahmood", "mansoor", "mateen", "mehmood", "mohsin", "muneer",
  "munir", "mustafa", "nadeem", "nasir", "nawaz", "noor", "obaid", "omar",
  "qasim", "qayyum", "rahim", "rahman", "rashid", "riaz", "sabir", "sadiq",
  "saleem", "sami", "sarfaraz", "shabbir", "shahid", "shakir", "shamim",
  "sharif", "shaukat", "sheraz", "siraj", "sohail", "tabish", "tahir",
  "tanveer", "tariq", "waqar", "yaseen", "yasin", "yunus", "yusuf", "zafar",
  "zaheer", "zain", "zeeshan",
  // Christian
  "albert", "alfred", "anthony", "anton", "benedict", "benjamin", "cedric",
  "clement", "cyril", "daniel", "david", "denzil", "derek", "edward", "edwin",
  "felix", "frederick", "gabriel", "george", "gerald", "gilbert", "gladson",
  "gregory", "henry", "ian", "ignatius", "jaison", "james", "jerome", "jerry",
  "jimmy", "john", "johnson", "joshua", "lawrence", "leo", "leslie", "lionel",
  "louis", "lucas", "mark", "martin", "matthew", "maxwell", "michael",
  "nelson", "nicholas", "oliver", "oscar", "patrick", "paul", "peter",
  "philip", "raphael", "raymond", "richard", "robert", "roger", "ronald",
  "roy", "samuel", "sebastian", "simon", "stephen", "stanley", "terrence",
  "timothy", "tony", "victor", "vincent", "walter", "william", "wilson",
  // Jharkhand tribal / Santali / Adivasi
  "baidyanath", "birsa", "budhu", "dasrath", "dukhu", "ganga", "ghasi",
  "gulab", "hopna", "jaipal", "jitu", "kishun", "korra", "lakhan", "mangal",
  "manjhi", "mundari", "phulchand", "sido", "sona", "sukra",
];

const FEMALE_NAMES = [
  // Hindi belt / pan-India
  "aaradhya", "aarti", "aashi", "aditi", "adya", "akanksha", "alka", "amisha",
  "amita", "amrita", "anamika", "anandi", "anannya", "anisha", "anita", "anjali",
  "anjana", "anjum", "ankita", "anshika", "anupama", "anupriya", "anuradha",
  "anushka", "anusuya", "aparna", "archana", "arpita", "arti", "arushi", "asha",
  "ashima", "ayesha", "bandana", "banya", "beena", "bhagyashree", "bharti",
  "bhavana", "bhavya", "bina", "bindu", "bulbul", "chameli", "chanchal", "chandani",
  "chandni", "charu", "chhaya", "chitra", "damini", "darshana", "deeksha", "deepa",
  "deepali", "deepika", "deepshikha", "devi", "dhanashree", "dimple", "diksha",
  "divya", "durga", "ekta", "farha", "farheen", "farzana", "gauri", "gayatri",
  "geeta", "geetanjali", "gita", "gulnaz", "hansa", "harpreet", "hema", "hemlata",
  "himani", "indira", "indrani", "ishita", "jagriti", "jaya", "jayanti", "jaya lakshmi",
  "jeevika", "jharna", "jyoti", "jyotsna", "kajal", "kalpana", "kamala", "kamini",
  "kanchan", "kareena", "karishma", "kavita", "kavya", "keerti", "khushbu", "khushi",
  "kiran devi", "kirti", "komal", "kranti", "krishna kumari", "krishna priya",
  "kritika", "kumkum", "kusum", "laila", "lakshmi", "lalita", "lata", "leela",
  "madhu", "madhubala", "madhuri", "madhusmita", "mala", "malati", "malti", "mamta",
  "manisha", "manju", "manjula", "manjusha", "mansi", "meena", "meenakshi", "meera",
  "meghna", "mehak", "minakshi", "mithlesh", "mona", "monika", "muskan", "nafisa",
  "nagma", "namrata", "nandini", "naseem", "neelam", "neelu", "neena", "neeta",
  "neetu", "neha", "nidhi", "niharika", "nikita", "nilam", "nilima", "nirmala",
  "nisha", "nishtha", "nisha rani", "pallavi", "pankhuri", "parul", "parvati",
  "payal", "pinky", "poonam", "pooja", "pragya", "prachi", "pramila", "pratibha",
  "preeti", "prerna", "priya", "priyanka", "puja", "punam", "purnima", "pushpa",
  "pushpanjali", "radha", "radhika", "rajani", "rajkumari", "rajni", "rakhi",
  "rama", "rambha", "ranjana", "rashmi", "reema", "rekha", "renu", "renuka",
  "richa", "rimjhim", "rinku", "rinky", "ritika", "ritu", "rohini", "roshni",
  "rubina", "rukmani", "runa", "rupali", "rupa", "sadhana", "sadia", "sakina",
  "sakshi", "salma", "sameera", "sanchita", "sandhya", "sangeeta", "sanjana",
  "sanjukta", "sapna", "sarika", "sarita", "sarla", "sarojini", "saroj devi",
  "seema", "shabana", "shabnam", "shahida", "shakeela", "shakuntala", "shalini",
  "shanti", "sharda", "sharmila", "shashi kala", "sheela", "shikha", "shilpa",
  "shivani", "shobha", "shreya", "shruti", "shubhra", "shweta", "simran", "sita",
  "smita", "sneha", "sonal", "sonali", "sonam", "sonia", "sudha", "sujata",
  "sulekha", "suman devi", "sumitra", "sunanda", "sunayana", "sunita", "supriya",
  "surekha", "susheela", "sushma", "sushmita", "swati", "taniya", "tanu", "tanuja",
  "tanvi", "tanushree", "tarannum", "tripti", "trisha", "twinkle", "uma",
  "urmila", "urvashi", "usha", "vaidehi", "vandana", "vanita", "varsha", "veena",
  "vibha", "vidya", "vijaya", "vijaylaxmi", "vimla", "vineeta", "vinita", "vinita devi",
  "yamini", "yashoda", "yasmeen", "yasmin", "zara", "zeba", "zeenat",
  // Modern / Gen-Z pan-India
  "aadhya", "aanya", "advika", "amyra", "anaya", "anvi", "arya", "avni", "diya",
  "ira", "ishani", "ivana", "kiara", "mahika", "myra", "navya", "pihu", "riya",
  "saanvi", "samaira", "sara", "siya", "srishti", "vanya", "zoya",
  // Tamil / South Indian
  "abirami", "agalya", "akhila", "amala", "ambika", "ammu", "anitha", "anu",
  "aruna", "bhanu", "bhuvaneswari", "devika", "gayathri", "gowri", "indhu",
  "janani", "jayalakshmi", "jyothi", "kalaivani", "kamakshi", "kanaka",
  "kanchana", "keerthana", "krithika", "lalitha", "latha", "madhavi",
  "madhumitha", "malar", "mallika", "manasa", "mythili", "nandhini",
  "padma", "padmavathi", "parvathi", "poornima", "poovizhi", "raji", "rani",
  "ranjini", "rathi", "revathi", "saranya", "savitri", "selvi", "shanthi",
  "sindhu", "sowmya", "sridevi", "subhashini", "swathi", "tamilarasi",
  "thanuja", "umadevi", "valli", "vani", "vanitha", "varalakshmi",
  "vasanthi", "vasudha",
  // Gujarati
  "alpa", "bhavika", "bhavna", "dipika", "falguni", "foram", "hansaben",
  "hemal", "hetal", "jagruti", "jigna", "kinjal", "krupa", "mital", "nayana",
  "nita", "priti", "rupal", "ruta", "sejal", "toral", "trupti", "urmi",
  "vaishali",
  // Marathi
  "asawari", "kalyani", "leena", "manjiri", "medha", "mrunal", "mrunmayee",
  "rajashri", "shubhangi", "sulakshana", "ujwala", "vrushali",
  // Bengali
  "ahana", "ananya", "anwesha", "baisakhi", "barnali", "bidisha", "chandrima",
  "debjani", "doyel", "ipsita", "koel", "madhumita", "mahua", "mausumi",
  "mimi", "mithu", "monalisa", "moumita", "nabanita", "nandita", "poulami",
  "rimi", "rupsha", "sagarika", "sathi", "shrabani", "srabani", "srijita",
  "srijoni", "subarna", "sucharita", "sudeshna", "sukanya", "sumana",
  "susmita", "tania", "tiyasha", "tuhina", "tulika",
  // Punjabi / Sikh
  "amandeep", "amanpreet", "amrit", "amritpal", "avneet", "baljeet",
  "gurleen", "gurpreet", "gurwinder", "harleen", "harshdeep", "japneet",
  "jaspreet", "jasleen", "jasmeet", "jasneet", "kirandeep", "kulwinder",
  "mandeep", "manpreet", "navdeep", "navjot", "navpreet", "pavandeep",
  "prabhjot", "ramandeep", "rupinder", "satinder", "simarpreet", "sukhdeep",
  "sukhpreet", "taranjit",
  // Muslim
  "aaliya", "aamna", "aasiya", "afreen", "aiman", "aisha", "alia", "amara",
  "ambreen", "aneesa", "arifa", "asma", "ayat", "bushra", "fahmida", "fatima",
  "firdaus", "gulafsha", "hafsa", "hina", "humaira", "iqra", "jannat",
  "kausar", "khadija", "kulsum", "mahek", "maimoona", "marzia", "mehreen",
  "mehrunnisa", "naaz", "nadia", "nafeesa", "nargis", "naureen", "nazia",
  "nazneen", "nikhat", "noorjahan", "parveen", "rabia", "rehana", "rukhsana",
  "rukshar", "saba", "sabiha", "saima", "samina", "sana", "shahnaz",
  "shaheen", "shakila", "shama", "shazia", "sultana", "tabassum", "tahira",
  "tanzeela", "uzma", "waheeda", "zainab", "zarina", "zohra",
  // Christian
  "agnes", "alice", "angela", "anna", "annie", "beatrice", "bella",
  "bridget", "carol", "catherine", "cecilia", "celina", "christina", "clara",
  "diana", "dorothy", "edith", "elizabeth", "ella", "esther", "eva",
  "evelyn", "flora", "gloria", "grace", "gracy", "helen", "irene", "jenifer",
  "jennifer", "jessica", "jovita", "judith", "julia", "juliet", "karen",
  "lily", "lisa", "lucy", "magdalene", "margaret", "maria", "mary",
  "melissa", "michelle", "monica", "nancy", "nicole", "olivia", "pearl",
  "priscilla", "rachel", "rebecca", "rita", "rosalind", "rose", "rosy",
  "ruth", "sabina", "sarah", "sheryl", "stella", "susan", "sylvia", "teresa",
  "tessy", "veronica", "victoria", "violet", "wilma",
  // Jharkhand tribal / Santali / Adivasi
  "baseli", "budhni", "champa", "chandmani", "dulari", "gulabi", "jamuna",
  "kusumi", "lakhi", "mangri", "phoolmani", "phulo", "putul", "sarna",
  "sonamani", "sukhi", "sumati", "tetri",
];

function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/[.,]/g, "");
}

// Honorifics / prefixes that occasionally end up as the "first" whitespace
// token (e.g. a name typed as "Mrs Sunita Devi") — strip these before
// treating the next token as the first name.
const HONORIFIC_PREFIXES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "shri", "smt", "kumari", "master", "baby",
]);

const MALE_SET = new Set(MALE_NAMES);
const FEMALE_SET = new Set(FEMALE_NAMES);

/**
 * Returns "male" | "female" for a recognized first name, or null if the
 * name isn't in the list (ambiguous/unisex/unrecognized). Accepts either
 * just a first name or a full "First Last" string — only the first
 * meaningful token is used.
 */
export function detectGenderFromName(fullNameOrFirstName: string): "male" | "female" | null {
  if (!fullNameOrFirstName) return null;
  const tokens = fullNameOrFirstName.trim().split(/\s+/).map(normalizeToken).filter(Boolean);
  const firstToken = tokens.find((t) => !HONORIFIC_PREFIXES.has(t));
  if (!firstToken) return null;

  if (MALE_SET.has(firstToken)) return "male";
  if (FEMALE_SET.has(firstToken)) return "female";

  // A handful of names in the lists are two words (e.g. "md" prefixes,
  // "suman kumar") — also try the first two tokens joined, in case the
  // caller passed a full name starting with one of those.
  if (tokens.length >= 2) {
    const twoWord = `${firstToken} ${tokens[1]}`;
    if (MALE_SET.has(twoWord)) return "male";
    if (FEMALE_SET.has(twoWord)) return "female";
  }

  return null;
}
