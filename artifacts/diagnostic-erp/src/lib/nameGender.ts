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
 * Coverage: common first names across Hindi, Bengali, Bihari/Jharkhandi,
 * Muslim, Christian, and Sikh naming traditions — broad enough for a
 * general diagnostic clinic, not exhaustive. Names that are genuinely
 * unisex in common usage (e.g. "Kiran", "Anand") are intentionally
 * omitted from both lists rather than guessed.
 */

const MALE_NAMES = [
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
];

const FEMALE_NAMES = [
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
