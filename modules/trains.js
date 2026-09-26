/**
 * SENJU Train Travel Agent
 * ------------------------
 * Research-only agent for Indian Railways travel:
 *   - trains between two stations with approximate fares per class (free, erail.in)
 *   - live seat availability, PNR and running status (optional RapidAPI "IRCTC1" key)
 *   - booking-site fee comparison (fare is identical everywhere; only fees differ)
 *   - seat watch: polls availability and alerts (desktop + WhatsApp) when a seat opens
 *   - opens the booking site with the search pre-filled
 *
 * It never logs in, never fills OTP/captcha and never pays. Those steps are the
 * user's — IRCTC blocks automated booking and it is not worth the account ban.
 */

const { execFile } = require('child_process');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// Station directory (code → name, common aliases)
// ─────────────────────────────────────────────────────────────
const STATIONS = [
  ['NDLS', 'New Delhi', 'delhi'], ['DLI', 'Old Delhi', 'delhi junction,purani dilli'], ['NZM', 'Hazrat Nizamuddin', 'nizamuddin,delhi'],
  ['ANVT', 'Anand Vihar Terminal', 'anand vihar,delhi'], ['DEE', 'Delhi Sarai Rohilla', 'sarai rohilla'], ['DSA', 'Delhi Shahdara', ''],
  ['GZB', 'Ghaziabad', ''], ['FDB', 'Faridabad', ''], ['GGN', 'Gurgaon', 'gurugram'],
  ['AGC', 'Agra Cantt', 'agra'], ['AF', 'Agra Fort', ''], ['RKM', 'Raja Ki Mandi', 'agra'], ['MTJ', 'Mathura Jn', 'mathura'],
  ['ADI', 'Ahmedabad Jn', 'ahmedabad,amdavad'], ['SBIB', 'Sabarmati BG', 'sabarmati'], ['MAN', 'Maninagar', 'ahmedabad'],
  ['BRC', 'Vadodara Jn', 'vadodara,baroda'], ['ST', 'Surat', ''],
  ['BCT', 'Mumbai Central', 'mumbai,bombay'], ['CSMT', 'Mumbai CSMT', 'mumbai,cst,vt,chhatrapati shivaji'], ['LTT', 'Lokmanya Tilak Terminus', 'kurla,mumbai'],
  ['BDTS', 'Bandra Terminus', 'bandra,mumbai'], ['BVI', 'Borivali', 'mumbai'],
  ['DR', 'Dadar', 'mumbai'], ['TNA', 'Thane', ''], ['KYN', 'Kalyan Jn', 'kalyan'], ['PNVL', 'Panvel', ''],
  ['PUNE', 'Pune Jn', 'pune'], ['NGP', 'Nagpur', ''], ['NK', 'Nasik Road', 'nashik'], ['SUR', 'Solapur', ''], ['KOP', 'Kolhapur', ''],
  ['RJT', 'Rajkot Jn', 'rajkot'], ['JAM', 'Jamnagar', ''], ['BVC', 'Bhavnagar Terminus', 'bhavnagar'], ['GIMB', 'Gandhidham', ''],
  ['BHUJ', 'Bhuj', ''], ['OKHA', 'Okha', ''], ['DWK', 'Dwarka', ''], ['UDN', 'Udhna Jn', 'surat'], ['ND', 'Nadiad Jn', 'nadiad'],
  ['ANND', 'Anand Jn', 'anand'], ['MSH', 'Mahesana Jn', 'mehsana'], ['PNU', 'Palanpur Jn', 'palanpur'], ['ABR', 'Abu Road', 'mount abu'],
  ['JP', 'Jaipur', ''], ['AII', 'Ajmer Jn', 'ajmer'], ['UDZ', 'Udaipur City', 'udaipur'], ['JU', 'Jodhpur Jn', 'jodhpur'], ['JSM', 'Jaisalmer', ''],
  ['BKN', 'Bikaner Jn', 'bikaner'], ['KOTA', 'Kota Jn', 'kota'], ['SWM', 'Sawai Madhopur', ''], ['AWR', 'Alwar', ''], ['RE', 'Rewari', ''],
  ['BPL', 'Bhopal Jn', 'bhopal'], ['RKMP', 'Rani Kamalapati', 'habibganj,bhopal'], ['INDB', 'Indore Jn', 'indore'], ['UJN', 'Ujjain Jn', 'ujjain'],
  ['JBP', 'Jabalpur', ''], ['GWL', 'Gwalior', ''], ['VGLJ', 'Virangana Lakshmibai Jhansi', 'jhansi'], ['BINA', 'Bina Jn', 'bina'], ['RTM', 'Ratlam Jn', 'ratlam'],
  ['ET', 'Itarsi Jn', 'itarsi'], ['KTE', 'Katni', ''], ['STA', 'Satna', ''], ['REWA', 'Rewa', ''],
  ['LKO', 'Lucknow NR', 'lucknow'], ['LJN', 'Lucknow Jn NER', 'lucknow'], ['CNB', 'Kanpur Central', 'kanpur'], ['PRYJ', 'Prayagraj Jn', 'allahabad,prayagraj'],
  ['BSB', 'Varanasi Jn', 'varanasi,banaras'], ['BSBS', 'Banaras', 'manduadih'], ['GKP', 'Gorakhpur Jn', 'gorakhpur'], ['BE', 'Bareilly', ''],
  ['MB', 'Moradabad', ''], ['ALJN', 'Aligarh Jn', 'aligarh'], ['TDL', 'Tundla Jn', 'tundla'], ['ETW', 'Etawah', ''], ['AY', 'Ayodhya Jn', 'ayodhya'],
  ['AYC', 'Ayodhya Cantt', 'faizabad'], ['JHS', 'Jhansi', ''], ['MZP', 'Mirzapur', ''], ['DDU', 'Pt Deen Dayal Upadhyaya Jn', 'mughalsarai'],
  ['HW', 'Haridwar Jn', 'haridwar'], ['DDN', 'Dehradun', ''], ['RKSH', 'Rishikesh', ''], ['KGM', 'Kathgodam', 'nainital'],
  ['CDG', 'Chandigarh', ''], ['ASR', 'Amritsar Jn', 'amritsar'], ['LDH', 'Ludhiana Jn', 'ludhiana'], ['JUC', 'Jalandhar City', 'jalandhar'],
  ['PTA', 'Patiala', ''], ['UMB', 'Ambala Cantt', 'ambala'], ['JAT', 'Jammu Tawi', 'jammu'], ['SVDK', 'Shri Mata Vaishno Devi Katra', 'katra,vaishno devi'],
  ['SML', 'Shimla', ''], ['KLK', 'Kalka', ''], ['UHP', 'Udhampur', ''], ['PNP', 'Panipat Jn', 'panipat'], ['KUN', 'Kurukshetra', ''],
  ['HWH', 'Howrah Jn', 'howrah,kolkata,calcutta'], ['SDAH', 'Sealdah', 'kolkata'], ['KOAA', 'Kolkata', 'chitpur'], ['SRC', 'Santragachi Jn', 'santragachi'],
  ['KGP', 'Kharagpur Jn', 'kharagpur'], ['ASN', 'Asansol Jn', 'asansol'], ['DGR', 'Durgapur', ''], ['NJP', 'New Jalpaiguri', 'siliguri,darjeeling'],
  ['MLDT', 'Malda Town', 'malda'], ['PNBE', 'Patna Jn', 'patna'], ['RJPB', 'Rajendra Nagar Terminal', 'patna'], ['DNR', 'Danapur', 'patna'],
  ['PPTA', 'Patliputra', 'patna'], ['GAYA', 'Gaya Jn', 'gaya'], ['MFP', 'Muzaffarpur Jn', 'muzaffarpur'], ['DBG', 'Darbhanga Jn', 'darbhanga'],
  ['BJU', 'Barauni Jn', 'barauni'], ['BGP', 'Bhagalpur', ''], ['CPR', 'Chhapra', ''], ['SEE', 'Sonpur', ''], ['HJP', 'Hajipur Jn', 'hajipur'],
  ['RNC', 'Ranchi', ''], ['DHN', 'Dhanbad Jn', 'dhanbad'], ['TATA', 'Tatanagar Jn', 'jamshedpur,tatanagar'], ['BKSC', 'Bokaro Steel City', 'bokaro'],
  ['BBS', 'Bhubaneswar', ''], ['CTC', 'Cuttack', ''], ['PURI', 'Puri', ''], ['BAM', 'Brahmapur', 'berhampur'], ['SBP', 'Sambalpur', ''], ['ROU', 'Rourkela', ''],
  ['R', 'Raipur Jn', 'raipur'], ['BSP', 'Bilaspur Jn', 'bilaspur'], ['DURG', 'Durg', ''], ['G', 'Gondia Jn', 'gondia'],
  ['GHY', 'Guwahati', ''], ['KYQ', 'Kamakhya', 'guwahati'], ['DBRG', 'Dibrugarh', ''], ['NTSK', 'New Tinsukia', 'tinsukia'], ['AGTL', 'Agartala', ''], ['SCL', 'Silchar', ''],
  ['MAS', 'Chennai Central', 'chennai,madras'], ['MS', 'Chennai Egmore', 'chennai,egmore'], ['TBM', 'Tambaram', 'chennai'], ['PER', 'Perambur', 'chennai'],
  ['CBE', 'Coimbatore Jn', 'coimbatore'], ['MDU', 'Madurai Jn', 'madurai'], ['TPJ', 'Tiruchchirappalli Jn', 'trichy,tiruchirappalli'], ['SA', 'Salem Jn', 'salem'],
  ['ED', 'Erode Jn', 'erode'], ['TEN', 'Tirunelveli', ''], ['CAPE', 'Kanniyakumari', 'kanyakumari'], ['KPD', 'Katpadi Jn', 'vellore,katpadi'],
  ['VM', 'Villupuram Jn', 'villupuram'], ['PDY', 'Puducherry', 'pondicherry'], ['TJ', 'Thanjavur', 'tanjore'], ['RMM', 'Rameswaram', ''],
  ['SBC', 'KSR Bengaluru', 'bangalore,bengaluru'], ['YPR', 'Yesvantpur Jn', 'yeshwantpur,bangalore'], ['BNC', 'Bengaluru Cantt', 'bangalore cantt'],
  ['SMVB', 'SMVT Bengaluru', 'baiyappanahalli,bangalore'], ['KJM', 'Krishnarajapuram', 'bangalore'], ['MYS', 'Mysuru Jn', 'mysore'], ['UBL', 'Hubballi Jn', 'hubli'],
  ['BGM', 'Belagavi', 'belgaum'], ['MAQ', 'Mangaluru Central', 'mangalore'], ['MAJN', 'Mangaluru Jn', 'mangalore'], ['DVG', 'Davangere', ''], ['GDG', 'Gadag', ''],
  ['SC', 'Secunderabad Jn', 'secunderabad,hyderabad'], ['HYB', 'Hyderabad Deccan', 'hyderabad,nampally'], ['KCG', 'Kacheguda', 'hyderabad'], ['LPI', 'Lingampalli', 'hyderabad'],
  ['BZA', 'Vijayawada Jn', 'vijayawada'], ['VSKP', 'Visakhapatnam', 'vizag'], ['TPTY', 'Tirupati', ''], ['RU', 'Renigunta Jn', 'renigunta,tirupati'],
  ['GNT', 'Guntur Jn', 'guntur'], ['WL', 'Warangal', ''], ['KZJ', 'Kazipet Jn', 'kazipet'], ['NLR', 'Nellore', ''], ['RJY', 'Rajahmundry', ''], ['GDR', 'Gudur Jn', 'gudur'],
  ['TVC', 'Thiruvananthapuram Central', 'trivandrum'], ['ERS', 'Ernakulam Jn', 'kochi,cochin,ernakulam'], ['ERN', 'Ernakulam Town', 'kochi'],
  ['CLT', 'Kozhikode', 'calicut'], ['TCR', 'Thrissur', 'trichur'], ['QLN', 'Kollam Jn', 'kollam,quilon'], ['KTYM', 'Kottayam', ''], ['CAN', 'Kannur', 'cannanore'],
  ['SRR', 'Shoranur Jn', 'shoranur'], ['PGT', 'Palakkad Jn', 'palakkad,palghat'], ['ALLP', 'Alappuzha', 'alleppey'],
  ['MAO', 'Madgaon Jn', 'goa,margao'], ['THVM', 'Thivim', 'goa'], ['KRMI', 'Karmali', 'goa,panaji'], ['VSG', 'Vasco Da Gama', 'goa'],
  ['RN', 'Ratnagiri', ''], ['UD', 'Udupi', ''], ['KUDL', 'Kudal', ''],
  ['DHD', 'Dahod', ''], ['GDA', 'Godhra Jn', 'godhra'], ['BH', 'Bharuch Jn', 'bharuch'], ['VAPI', 'Vapi', ''], ['VR', 'Virar', ''],
  ['SNSI', 'Sainagar Shirdi', 'shirdi'], ['KPG', 'Kopargaon', 'shirdi'], ['MMR', 'Manmad Jn', 'manmad'], ['BSL', 'Bhusaval Jn', 'bhusaval'],
  ['AK', 'Akola Jn', 'akola'], ['BD', 'Badnera Jn', 'amravati'], ['AWB', 'Aurangabad', 'chhatrapati sambhajinagar'], ['NED', 'Nanded', ''],
  ['MRJ', 'Miraj Jn', 'miraj,sangli'], ['STR', 'Satara', ''], ['LNL', 'Lonavala', ''], ['KJT', 'Karjat', ''],
  ['DHNE', 'Dhone', ''], ['GTL', 'Guntakal Jn', 'guntakal'], ['GY', 'Gooty', ''], ['ATP', 'Anantapur', ''], ['DMM', 'Dharmavaram Jn', 'dharmavaram'],
  ['KLBG', 'Kalaburagi', 'gulbarga'], ['SUR', 'Solapur', ''], ['WADI', 'Wadi', ''], ['RC', 'Raichur', ''], ['BAY', 'Ballari', 'bellary'],
  ['NGO', 'Nagaon', ''], ['SGUJ', 'Siliguri Jn', 'siliguri'], ['APDJ', 'Alipurduar Jn', 'alipurduar'], ['NCB', 'New Cooch Behar', 'cooch behar'],
  ['HRI', 'Hardoi', ''], ['SPN', 'Shahjahanpur', ''], ['RBL', 'Rae Bareli', ''], ['SLN', 'Sultanpur', ''], ['JNU', 'Jaunpur Jn', 'jaunpur'], ['BST', 'Basti', ''],
  ['DEOS', 'Deoria Sadar', 'deoria'], ['BUI', 'Ballia', ''], ['GCT', 'Ghazipur City', 'ghazipur'], ['ARA', 'Ara', ''], ['BXR', 'Buxar', ''], ['SSM', 'Sasaram', ''],
  ['MKA', 'Mokama', ''], ['KIUL', 'Kiul Jn', 'kiul,lakhisarai'], ['JAJ', 'Jhajha', ''], ['JSME', 'Jasidih Jn', 'deoghar,jasidih'], ['MDP', 'Madhupur', ''],
  ['HRD', 'Harda', ''], ['KNW', 'Khandwa', ''], ['BAU', 'Burhanpur', ''], ['CD', 'Chandrapur', ''], ['BPQ', 'Balharshah', ''],
  ['SEGM', 'Sewagram', 'wardha'], ['WR', 'Wardha Jn', 'wardha'], ['AMI', 'Amravati', ''], ['SNSI', 'Sainagar Shirdi', 'shirdi'],
  ['UMR', 'Umaria', ''], ['SGRL', 'Singrauli', ''], ['ANPR', 'Anuppur', ''], ['SDL', 'Shahdol', ''], ['PND', 'Pendra Road', ''],
  ['DMO', 'Damoh', ''], ['SGO', 'Saugor', 'sagar'], ['MBA', 'Mahoba', ''], ['BNDA', 'Banda', ''], ['CKTD', 'Chitrakoot Dham', 'chitrakoot'],
  ['ORAI', 'Orai', ''], ['LAR', 'Lalitpur', ''], ['DAA', 'Datia', ''], ['DBA', 'Dabra', ''], ['MRA', 'Morena', ''], ['DHO', 'Dholpur', ''],
  ['BTE', 'Bharatpur Jn', 'bharatpur'], ['GGC', 'Gangapur City', ''], ['BKI', 'Bandikui', ''], ['DO', 'Dausa', ''], ['FL', 'Phulera', ''],
  ['KSG', 'Kishangarh', ''], ['BER', 'Beawar', ''], ['MJ', 'Marwar Jn', 'marwar'], ['FA', 'Falna', ''], ['RANI', 'Rani', ''], ['JWB', 'Jawai Bandh', ''],
  ['SOH', 'Sirohi Road', ''], ['SIOB', 'Siddhpur', 'sidhpur'], ['UJA', 'Unjha', ''], ['KLL', 'Kalol Jn', 'kalol'], ['VG', 'Viramgam Jn', 'viramgam'],
  ['SUNR', 'Surendranagar', ''], ['WKR', 'Wankaner Jn', 'wankaner'], ['MVI', 'Morbi', ''], ['JND', 'Junagadh Jn', 'junagadh'], ['VRL', 'Veraval', 'somnath'],
  ['PBR', 'Porbandar', ''], ['DWK', 'Dwarka', ''], ['BTD', 'Botad Jn', 'botad'], ['DLJ', 'Dhola Jn', ''], ['GNC', 'Gandhinagar Capital', 'gandhinagar'],
  ['ASV', 'Asarva', 'ahmedabad'], ['HMT', 'Himmatnagar', ''], ['DNRP', 'Dungarpur', ''], ['MHOW', 'Dr Ambedkar Nagar', 'mhow'],
  ['DWX', 'Dewas', ''], ['MKC', 'Maksi', ''], ['SFY', 'Shujalpur', ''], ['SEH', 'Sehore', ''], ['BAQ', 'Ganj Basoda', ''],
  ['BHS', 'Vidisha', ''], ['HBD', 'Hoshangabad', 'narmadapuram'], ['PPI', 'Pipariya', 'pachmarhi'], ['NU', 'Narsinghpur', ''], ['MML', 'Madan Mahal', 'jabalpur'],
  ['NIR', 'Nainpur', ''], ['CWA', 'Chhindwara', ''], ['BTC', 'Balaghat', ''], ['SEY', 'Seoni', ''], ['AMLA', 'Amla Jn', 'amla'], ['BZU', 'Betul', ''],
];

const STATION_BY_CODE = new Map();
for (const [code, name, aliases] of STATIONS) {
  if (!STATION_BY_CODE.has(code)) STATION_BY_CODE.set(code, { code, name, aliases: aliases ? aliases.split(',') : [] });
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolve "agra", "Agra Cantt", "AGC" → { code, name }. Returns null when unknown. */
function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (/^[A-Z]{1,5}$/.test(up) && STATION_BY_CODE.has(up)) return STATION_BY_CODE.get(up);
  const q = norm(raw).replace(/\b(junction|jn|station|railway|city|cantt|cant)\b/g, '').trim();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const st of STATION_BY_CODE.values()) {
    const name = norm(st.name);
    const candidates = [name, ...st.aliases.map(norm)];
    let score = 0;
    for (const c of candidates) {
      if (!c) continue;
      if (c === q) score = Math.max(score, 100);
      else if (c.startsWith(q) || q.startsWith(c)) score = Math.max(score, 80 - Math.abs(c.length - q.length));
      else if (c.includes(q) || q.includes(c)) score = Math.max(score, 60 - Math.abs(c.length - q.length));
    }
    if (score > bestScore) { bestScore = score; best = st; }
  }
  if (bestScore >= 55) return best;
  // Unknown but looks like a code the model supplied — trust it
  if (/^[A-Z]{2,5}$/.test(up)) return { code: up, name: up, aliases: [] };
  return null;
}

function stationSuggestions(input, limit = 8) {
  const q = norm(input);
  if (!q) return [];
  const scored = [];
  for (const st of STATION_BY_CODE.values()) {
    const code = st.code.toLowerCase();
    const name = norm(st.name);
    let score = 0;
    if (code === q) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (st.aliases.some((a) => norm(a).startsWith(q))) score = 80;
    else if (code.startsWith(q)) score = 70;
    else if (name.includes(q)) score = 50;
    else if (st.aliases.some((a) => norm(a).includes(q))) score = 40;
    if (score) scored.push({ score, code: st.code, name: st.name });
  }
  // stable: higher score first, otherwise directory order (main stations are listed first)
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ code, name }) => ({ code, name }));
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
// erail fare groups / class bitmask positions (verified against live data)
const CLASS_ORDER = ['1A', '2A', '3A', 'CC', 'FC', 'SL', 'EA', '3E', '2S', 'VS', 'EC', null, null, null, null, null];
const CLASS_LABEL = { '1A': 'First AC', '2A': 'AC 2 Tier', '3A': 'AC 3 Tier', '3E': 'AC 3 Economy', SL: 'Sleeper', CC: 'AC Chair Car', EC: 'Exec. Chair', '2S': 'Second Sitting', FC: 'First Class', EA: 'Anubhuti', VS: 'Vistadome' };
const CLASS_RANK = { '2S': 0, SL: 1, '3E': 2, CC: 3, '3A': 4, FC: 5, '2A': 6, EC: 7, EA: 8, VS: 9, '1A': 10 };
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Booking sites. Base fare is identical everywhere (set by Indian Railways);
 * only the agent/convenience fee and payment-gateway charge differ. These are
 * typical published values — treated as approximate and shown as such.
 */
const SITES = [
  { id: 'irctc', name: 'IRCTC (official)', fee: 0, pgPct: 0, pgNote: 'UPI free; cards ~1%', color: '#ff9f43',
    url: () => 'https://www.irctc.co.in/nget/train-search', prefill: false },
  { id: 'confirmtkt', name: 'ConfirmTkt', fee: 35, pgPct: 1.8, pgNote: 'shows confirm chance', color: '#2ecc71',
    url: (q) => `https://www.confirmtkt.com/rbooking-d/${q.from}/${q.to}/${q.dmy}`, prefill: true },
  { id: 'ixigo', name: 'ixigo', fee: 35, pgPct: 1.8, pgNote: 'frequent coupons', color: '#e74c3c',
    url: (q) => `https://www.ixigo.com/search/result/train/${q.from}/${q.to}/${q.ddmmyyyy}//1/0/0/0/ALL`, prefill: true },
  { id: 'railyatri', name: 'RailYatri', fee: 30, pgPct: 1.8, pgNote: '', color: '#3498db',
    url: (q) => `https://www.railyatri.in/trains-between-stations/${q.from}/${q.to}?journey_date=${q.ymd}`, prefill: true },
  { id: 'paytm', name: 'Paytm', fee: 30, pgPct: 1.5, pgNote: 'wallet cashback at times', color: '#00b9f1',
    url: (q) => `https://tickets.paytm.com/trains/searchTrains/${q.from}/${q.to}/${q.yyyymmdd}`, prefill: true },
  { id: 'mmt', name: 'MakeMyTrip', fee: 45, pgPct: 1.8, pgNote: '', color: '#e0342e',
    url: (q) => `https://www.makemytrip.com/railways/listing/?srcStn=${q.from}&destStn=${q.to}&date=${q.yyyymmdd}&classCode=${q.cls || ''}`, prefill: true },
];

const RAPID_HOST = 'irctc1.p.rapidapi.com';
const ERAIL = 'https://erail.in/rail/getTrains.aspx';
const WATCH_INTERVAL_MS = 20 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function fetchText(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

function openInBrowser(url) {
  execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, (err) => {
    if (err) console.error('[Trains] open url failed:', err.message);
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function parseDateInput(input) {
  // Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, "today", "tomorrow", "" (today)
  const s = String(input || '').trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let d;
  if (!s || s === 'today' || s === 'aaj' || s === 'aj') d = today;
  else if (s === 'tomorrow' || s === 'kal') d = new Date(today.getTime() + 86400000);
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.slice(0, 10) + 'T00:00:00');
  else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(/[-/]/).map(Number);
    d = new Date(yyyy, mm - 1, dd);
  } else {
    const t = Date.parse(s);
    if (!isNaN(t)) d = new Date(t);
  }
  if (!d || isNaN(d.getTime())) throw new Error(`Could not understand the date "${input}". Use YYYY-MM-DD.`);
  return d;
}

function dateParts(d) {
  const yyyy = d.getFullYear(), mm = pad2(d.getMonth() + 1), dd = pad2(d.getDate());
  return {
    ymd: `${yyyy}-${mm}-${dd}`,
    dmy: `${dd}-${mm}-${yyyy}`,
    ddmmyyyy: `${dd}${mm}${yyyy}`,
    yyyymmdd: `${yyyy}${mm}${dd}`,
    weekdayIndex: (d.getDay() + 6) % 7, // Mon = 0
  };
}

function hmToMin(hm) {
  const m = String(hm || '').match(/(\d{1,2})[.:](\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function minToText(min) {
  if (min == null) return '—';
  return `${Math.floor(min / 60)}h ${pad2(min % 60)}m`;
}

function normalizeClass(cls) {
  if (!cls) return null;
  const c = String(cls).toUpperCase().replace(/\s+/g, '');
  const map = { SLEEPER: 'SL', SL: 'SL', '3AC': '3A', '3A': '3A', AC3: '3A', '3TIER': '3A', '2AC': '2A', '2A': '2A', AC2: '2A',
    '1AC': '1A', '1A': '1A', FIRSTAC: '1A', '3E': '3E', '3ECONOMY': '3E', ECONOMY: '3E', CC: 'CC', CHAIRCAR: 'CC', CHAIR: 'CC',
    EC: 'EC', EXECUTIVE: 'EC', '2S': '2S', SECONDSITTING: '2S', SITTING: '2S', GENERAL: '2S', FC: 'FC', EA: 'EA', VS: 'VS' };
  return map[c] || (CLASS_RANK[c] !== undefined ? c : null);
}

// ─────────────────────────────────────────────────────────────
// erail parsing
// ─────────────────────────────────────────────────────────────
function parseErail(text) {
  const records = text.split('^').map((r) => r.trim()).filter(Boolean);
  const trains = [];
  for (const rec of records) {
    let f = rec.split('~');
    // records normally start with the train number; tolerate a leading empty field
    if (f[0] === '' && /^\d{5}$/.test(f[1] || '')) f = f.slice(1);
    if (f.length < 20 || !/^\d{5}$/.test(f[0] || '')) continue;
    const days = /^[01]{7}$/.test(f[13] || '') ? f[13] : (f.find((x) => /^[01]{7}$/.test(x)) || '1111111');
    const fareField = f.find((x) => /^[A-Z_]+:\d+:(?:\d*,){5}\d*:/.test(x)) || '';
    const fareParts = fareField.split(':');
    const distanceKm = fareParts[1] ? parseInt(fareParts[1], 10) : null;
    const fares = {};
    for (let i = 2; i < fareParts.length; i++) {
      const cls = CLASS_ORDER[i - 2];
      if (!cls) continue;
      const first = parseInt(String(fareParts[i]).split(',')[0], 10);
      if (first > 0) fares[cls] = first;
    }
    const mask = f.find((x) => /^[01]{15}$/.test(x)) || '';
    const classes = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === '1' && CLASS_ORDER[i]) classes.push(CLASS_ORDER[i]);
    for (const c of Object.keys(fares)) if (!classes.includes(c)) classes.push(c);
    classes.sort((a, b) => (CLASS_RANK[a] ?? 99) - (CLASS_RANK[b] ?? 99));

    const depMin = hmToMin(f[10]);
    const durMin = hmToMin(f[12]);
    const arrDayOffset = depMin != null && durMin != null ? Math.floor((depMin + durMin) / 1440) : 0;

    trains.push({
      no: f[0],
      name: (f[1] || '').trim(),
      from: f[7], fromName: f[6],
      to: f[9], toName: f[8],
      source: f[3], sourceName: f[2],
      destination: f[5], destinationName: f[4],
      dep: (f[10] || '').replace('.', ':'),
      arr: (f[11] || '').replace('.', ':'),
      durationMin: durMin,
      duration: minToText(durMin),
      arrDayOffset,
      days,
      runsOn: DAY_SHORT.filter((_, i) => days[i] === '1'),
      type: (fareParts[0] || f[31] || '').replace(/_/g, ' '),
      distanceKm,
      classes,
      fares,
    });
  }
  return trains;
}

// ─────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────
class TrainAgent {
  /**
   * @param {object} store electron-store
   * @param {object} deps { whatsapp?, getRapidKey?: () => string }
   */
  constructor(store, deps = {}) {
    this.store = store;
    this.deps = deps;
    this.window = null;
    this.timer = null;
    this.cache = new Map(); // route → { at, trains }
  }

  // --- config -----------------------------------------------------------
  rapidKey() {
    const k = this.deps.getRapidKey ? this.deps.getRapidKey() : (this.store.get('settings') || {}).rapidApiKey;
    return (k || '').trim();
  }

  hasLiveData() { return !!this.rapidKey(); }

  sites() { return SITES.map(({ id, name, fee, pgPct, pgNote }) => ({ id, name, fee, pgPct, pgNote })); }

  // --- core search ------------------------------------------------------
  async fetchRoute(fromCode, toCode) {
    const key = `${fromCode}>${toCode}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.trains;
    const url = `${ERAIL}?Station_From=${encodeURIComponent(fromCode)}&Station_To=${encodeURIComponent(toCode)}&DataSource=0&Language=0&Cache=true`;
    const text = await fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0 SENJU', Accept: 'text/plain,*/*' } });
    if (/error occurred|<html/i.test(text.slice(0, 400)) && !text.includes('^')) throw new Error('Train data service (erail) returned an error page. Try again in a minute.');
    const trains = parseErail(text);
    this.cache.set(key, { at: Date.now(), trains });
    return trains;
  }

  /**
   * @param {object} q { from, to, date, cls?, sort?: 'price'|'duration'|'departure', withAvailability?: boolean }
   */
  async search(q = {}) {
    const from = resolveStation(q.from);
    const to = resolveStation(q.to);
    if (!from) throw new Error(`Unknown origin station "${q.from}". Give the station code (e.g. AGC for Agra Cantt).`);
    if (!to) throw new Error(`Unknown destination station "${q.to}". Give the station code (e.g. ADI for Ahmedabad).`);
    if (from.code === to.code) throw new Error('Origin and destination are the same station.');
    const d = parseDateInput(q.date);
    const parts = dateParts(d);
    const cls = normalizeClass(q.cls);

    const all = await this.fetchRoute(from.code, to.code);
    const onDate = all.filter((t) => t.days[parts.weekdayIndex] === '1');
    let list = onDate.map((t) => ({ ...t }));
    if (cls) list = list.filter((t) => t.classes.includes(cls) || t.fares[cls]);

    // stats
    const fareOf = (t) => (cls ? t.fares[cls] : Math.min(...Object.values(t.fares).filter(Boolean))) || null;
    const priced = list.filter((t) => fareOf(t));
    const avgFare = priced.length ? Math.round(priced.reduce((s, t) => s + fareOf(t), 0) / priced.length) : null;
    const cheapest = priced.length ? priced.reduce((a, b) => (fareOf(a) <= fareOf(b) ? a : b)) : null;
    const fastest = list.length ? list.reduce((a, b) => ((a.durationMin ?? 1e9) <= (b.durationMin ?? 1e9) ? a : b)) : null;

    for (const t of list) {
      t.fare = fareOf(t);
      t.tags = [];
      if (cheapest && t.no === cheapest.no) t.tags.push('cheapest');
      if (fastest && t.no === fastest.no) t.tags.push('fastest');
      if (t.fare && avgFare) t.vsAvgPct = Math.round(((t.fare - avgFare) / avgFare) * 100);
    }

    const sort = q.sort || (cls ? 'price' : 'departure');
    list.sort((a, b) => {
      if (sort === 'price') return (a.fare ?? 1e9) - (b.fare ?? 1e9) || (a.durationMin ?? 1e9) - (b.durationMin ?? 1e9);
      if (sort === 'duration') return (a.durationMin ?? 1e9) - (b.durationMin ?? 1e9);
      return (hmToMin(a.dep) ?? 0) - (hmToMin(b.dep) ?? 0);
    });

    // class-wise averages (useful when no class given)
    const classAvg = {};
    for (const c of Object.keys(CLASS_RANK)) {
      const vals = onDate.map((t) => t.fares[c]).filter(Boolean);
      if (vals.length) classAvg[c] = { avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length), min: Math.min(...vals), max: Math.max(...vals), trains: vals.length };
    }

    // live availability for the top few trains (optional, needs key)
    let availabilityNote = null;
    if (q.withAvailability !== false && cls && this.hasLiveData()) {
      const top = list.slice(0, Math.min(6, list.length));
      await Promise.all(top.map(async (t) => {
        try { t.availability = await this.availability({ trainNo: t.no, from: from.code, to: to.code, date: parts.ymd, cls }); }
        catch (e) { t.availability = { status: 'unknown', error: String(e.message).slice(0, 80) }; }
      }));
    } else if (cls && !this.hasLiveData()) {
      availabilityNote = 'Live seat availability needs a RapidAPI key (Settings → Travel). Fares and timings are still accurate.';
    }

    const result = {
      from: { code: from.code, name: from.name },
      to: { code: to.code, name: to.name },
      date: parts.ymd,
      weekday: DAY_SHORT[parts.weekdayIndex],
      cls,
      sort,
      totalOnRoute: all.length,
      count: list.length,
      avgFare,
      classAvg,
      cheapest: cheapest ? { no: cheapest.no, name: cheapest.name, fare: fareOf(cheapest) } : null,
      fastest: fastest ? { no: fastest.no, name: fastest.name, duration: fastest.duration } : null,
      trains: list,
      sites: cheapest ? this.compareSites(fareOf(cheapest), { from: from.code, to: to.code, date: parts.ymd, cls }) : null,
      liveData: this.hasLiveData(),
      availabilityNote,
      fareNote: 'Fares are approximate base fares (erail). Final IRCTC price adds reservation/superfast charges & GST, and premium trains use dynamic pricing.',
    };
    return result;
  }

  // --- site comparison --------------------------------------------------
  compareSites(fare, q = {}) {
    const f = Number(fare) || 0;
    const parts = q.date ? dateParts(parseDateInput(q.date)) : null;
    const ctx = { from: q.from, to: q.to, cls: q.cls, ...(parts || {}) };
    const rows = SITES.map((s) => {
      const pg = Math.round((f + s.fee) * (s.pgPct / 100));
      const total = f + s.fee + pg;
      return { id: s.id, name: s.name, fee: s.fee, pg, total, extra: total - f, note: s.pgNote, url: q.from && q.to && parts ? s.url(ctx) : s.url({}), prefill: s.prefill, color: s.color };
    }).sort((a, b) => a.total - b.total);
    return { fare: f, rows, note: 'Base fare is identical on every site (fixed by Indian Railways). Only convenience fee + payment charges differ; values are typical and approximate.' };
  }

  bookingUrl(q = {}) {
    const from = resolveStation(q.from), to = resolveStation(q.to);
    if (!from || !to) throw new Error('Need valid from/to stations to open booking.');
    const parts = dateParts(parseDateInput(q.date));
    const site = SITES.find((s) => s.id === String(q.site || 'irctc').toLowerCase()) || SITES[0];
    const url = site.url({ from: from.code, to: to.code, cls: normalizeClass(q.cls) || '', ...parts });
    return { site: site.name, prefill: site.prefill, url, from: from.code, to: to.code, date: parts.ymd };
  }

  openBooking(q = {}) {
    const info = this.bookingUrl(q);
    openInBrowser(info.url);
    return info;
  }

  // --- RapidAPI (optional) ---------------------------------------------
  async rapid(pathAndQuery) {
    const key = this.rapidKey();
    if (!key) throw new Error('No RapidAPI key. Add it in Settings → Travel to enable live availability, PNR and running status.');
    const text = await fetchText(`https://${RAPID_HOST}${pathAndQuery}`, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': RAPID_HOST },
    }, 20000);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('RapidAPI returned a non-JSON response.'); }
    if (data && data.status === false) throw new Error(data.message || 'RapidAPI request failed');
    return data && data.data !== undefined ? data.data : data;
  }

  /** Live seat availability for one train/class. Returns {status, raw, probability?} */
  async availability({ trainNo, from, to, date, cls, quota = 'GN' }) {
    const f = resolveStation(from), t = resolveStation(to);
    const parts = dateParts(parseDateInput(date));
    const c = normalizeClass(cls) || 'SL';
    const data = await this.rapid(
      `/api/v1/checkSeatAvailability?classType=${encodeURIComponent(c)}&fromStationCode=${f.code}&quota=${quota}&toStationCode=${t.code}&trainNo=${encodeURIComponent(trainNo)}&date=${parts.ymd}`
    );
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.avlDayList) ? data.avlDayList : [data]);
    const row = rows.find((r) => r && (String(r.date || r.availablityDate || '').includes(parts.dmy) || String(r.date || '').includes(parts.ymd))) || rows[0] || {};
    const statusText = String(row.current_status || row.availablityStatus || row.availability || row.status || row.availablity_status || '').trim();
    return {
      status: classifyAvailability(statusText),
      text: statusText || 'unknown',
      probability: row.confirm_probability ?? row.probability ?? row.confirmProbability ?? null,
      fare: row.fare ?? row.totalFare ?? null,
      checkedAt: new Date().toISOString(),
      cls: c,
      quota,
    };
  }

  // --- headless-browser scraping (no API key needed) ---------------------
  /**
   * Load a public status page in a hidden Chrome (puppeteer, already installed for
   * WhatsApp), wait until the page text matches `mustMatch`, return the visible text.
   */
  async scrapeText(url, { mustMatch, timeoutMs = 30000, settleMs = 2000 } = {}) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions',
        '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1280,900'],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', (r) => (['image', 'font', 'media'].includes(r.resourceType()) ? r.abort() : r.continue()));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const deadline = Date.now() + timeoutMs;
      let text = '';
      const grab = () => page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        text = await grab();
        if (!mustMatch || mustMatch.test(text)) {
          await new Promise((r) => setTimeout(r, settleMs));
          text = await grab();
          break;
        }
      }
      return text;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /** Keep the interesting part of a page: lines around the first `anchor` match, de-noised. */
  static trimAround(text, anchor, before = 15, after = 70, maxChars = 5000) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && l.length < 200);
    let i = lines.findIndex((l) => anchor.test(l));
    if (i < 0) i = 0;
    return lines.slice(Math.max(0, i - before), i + after).join('\n').slice(0, maxChars);
  }

  /** Ask Groq (fast small model) to turn scraped text into a fixed JSON shape. */
  async structure(text, instruction) {
    const apiKey = this.deps.getApiKey ? this.deps.getApiKey() : '';
    if (!apiKey) return null;
    const body = {
      model: 'openai/gpt-oss-20b',
      temperature: 0,
      reasoning_effort: 'low',
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${instruction}\nReturn ONLY valid JSON. Use null for unknown fields. Never invent values that are not in the text.` },
        { role: 'user', content: text },
      ],
    };
    const raw = await fetchText('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 30000);
    try {
      const data = JSON.parse(raw);
      return JSON.parse(data.choices?.[0]?.message?.content || 'null');
    } catch { return null; }
  }

  async pnrStatus(pnr) {
    const p = String(pnr || '').replace(/\D/g, '');
    if (p.length !== 10) throw new Error('PNR must be 10 digits.');
    const cached = this.cache.get(`pnr:${p}`);
    if (cached && Date.now() - cached.at < 2 * 60 * 1000) return cached.data;

    let out;
    if (this.hasLiveData()) {
      try { out = await this._pnrViaRapid(p); } catch (e) { console.warn('[Trains] RapidAPI PNR failed, falling back to browser:', e.message); }
    }
    if (!out) out = await this._pnrViaBrowser(p);
    this.cache.set(`pnr:${p}`, { at: Date.now(), data: out });
    return out;
  }

  async _pnrViaRapid(p) {
    const d = await this.rapid(`/api/v3/getPNRStatus?pnrNumber=${p}`);
    const passengers = (d.PassengerStatus || d.passengerList || d.passengers || []).map((x, i) => ({
      no: x.Number || x.passengerSerialNumber || i + 1,
      booking: x.BookingStatus || x.bookingStatus || '',
      current: x.CurrentStatus || x.currentStatus || '',
      coach: x.Coach || x.currentCoachId || '',
      berth: x.Berth || x.currentBerthNo || '',
    }));
    return {
      pnr: p, source: 'RapidAPI',
      train: `${d.TrainNo || d.trainNumber || ''} ${d.TrainName || d.trainName || ''}`.trim(),
      from: d.From || d.boardingPoint || d.sourceStation || '',
      to: d.To || d.reservationUpto || d.destinationStation || '',
      date: d.Doj || d.dateOfJourney || '',
      cls: d.Class || d.journeyClass || '',
      chartPrepared: d.ChartPrepared ?? d.chartStatus ?? null,
      passengers,
      raw: '',
    };
  }

  async _pnrViaBrowser(p) {
    const sources = [
      { name: 'ConfirmTkt', url: `https://www.confirmtkt.com/pnr-status/${p}` },
      { name: 'RailYatri', url: `https://www.railyatri.in/pnr-status/${p}` },
    ];
    const ready = /chart|booking status|current status|passenger|flushed|invalid|not found|cnf|rac|wl/i;
    let text = '', source = '', lastErr = null;
    for (const src of sources) {
      try {
        const t = await this.scrapeText(src.url, { mustMatch: ready, timeoutMs: 30000 });
        if (t && ready.test(t)) { text = t; source = src.name; break; }
      } catch (e) { lastErr = e; }
    }
    if (!text) throw new Error(`Could not load PNR status${lastErr ? ` (${lastErr.message.slice(0, 80)})` : ''}. Check the internet connection and try again.`);

    const snippet = TrainAgent.trimAround(text, new RegExp(p), 10, 80);
    if (/flushed|invalid pnr|not found|pnr not yet generated/i.test(snippet) && !/cnf|rac|wl|confirmed/i.test(snippet)) {
      return { pnr: p, source, invalid: true, train: '', from: '', to: '', date: '', cls: '', chartPrepared: null, passengers: [], raw: 'PNR not found / flushed. Check the number (PNR is valid only until the journey date + a few days).' };
    }
    const j = await this.structure(snippet,
      'Extract Indian Railways PNR status from the page text as JSON: {"train":"12958 SWARNA J RAJ EXP","from":"station name (code)","to":"station name (code)","date":"journey date as written","cls":"3A","quota":"GN","chartPrepared":true|false|null,' +
      '"passengers":[{"no":1,"booking":"booking status e.g. GNWL 12","current":"current status e.g. CNF B3/45 or RAC 20 or WL 5","coach":"B3","berth":"45 LB","confirmChance":"78%"}],"note":"one short line e.g. prediction or boarding info"}');
    return {
      pnr: p, source,
      train: j?.train || '', from: j?.from || '', to: j?.to || '', date: j?.date || '', cls: j?.cls || '', quota: j?.quota || '',
      chartPrepared: j?.chartPrepared ?? null,
      passengers: Array.isArray(j?.passengers) ? j.passengers.map((x, i) => ({ no: x.no || i + 1, booking: x.booking || '', current: x.current || '', coach: x.coach || '', berth: x.berth || '', confirmChance: x.confirmChance || '' })) : [],
      note: j?.note || '',
      raw: j ? '' : snippet.split('\n').slice(0, 25).join('\n'),
    };
  }

  async liveStatus(trainNo, startDay = 0) {
    const no = String(trainNo || '').replace(/\D/g, '');
    if (no.length !== 5) throw new Error('Train number must be 5 digits.');
    const key = `live:${no}:${startDay}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;

    let out;
    if (this.hasLiveData()) {
      try { out = await this._liveViaRapid(no, startDay); } catch (e) { console.warn('[Trains] RapidAPI live status failed, falling back to browser:', e.message); }
    }
    if (!out) out = await this._liveViaBrowser(no);
    this.cache.set(key, { at: Date.now(), data: out });
    return out;
  }

  async _liveViaRapid(no, startDay) {
    const d = await this.rapid(`/api/v1/liveTrainStatus?trainNo=${no}&startDay=${startDay}`);
    return {
      trainNo: no, source: 'RapidAPI',
      trainName: d.train_name || d.trainName || '',
      currentStation: d.current_station_name || d.currentStation || d.current_station || '',
      delayMin: d.delay ?? d.delayMinutes ?? null,
      status: d.status || d.new_message || d.message || '',
      lastUpdated: d.updated_time || d.lastUpdated || '',
      eta: d.eta || '',
      upcoming: (d.upcoming_stations || []).slice(0, 5).map((s) => ({ name: s.station_name, eta: s.eta, delay: s.arrival_delay })),
      raw: '',
    };
  }

  async _liveViaBrowser(no) {
    const sources = [
      { name: 'ConfirmTkt', url: `https://www.confirmtkt.com/train-running-status/${no}` },
      { name: 'RailYatri', url: `https://www.railyatri.in/live-train-status/${no}` },
    ];
    const ready = /delay|on time|late|arrived|departed|yet to start|not started|cancelled|running status|last updated|expected/i;
    let text = '', source = '', lastErr = null;
    for (const src of sources) {
      try {
        const t = await this.scrapeText(src.url, { mustMatch: ready, timeoutMs: 30000, settleMs: 2500 });
        if (t && ready.test(t) && t.includes(no)) { text = t; source = src.name; break; }
      } catch (e) { lastErr = e; }
    }
    if (!text) throw new Error(`Could not load running status${lastErr ? ` (${lastErr.message.slice(0, 80)})` : ''}. Check the internet connection and try again.`);

    const snippet = TrainAgent.trimAround(text, new RegExp(no), 10, 90, 6000);
    const j = await this.structure(snippet,
      'Extract the live running status of an Indian Railways train from the page text as JSON: {"trainName":"...","startDate":"journey start date if shown","status":"one line: e.g. Running 25 min late / On time / Yet to start / Reached destination",' +
      '"currentStation":"last reported station or current position","lastUpdated":"as written","delayMin":25,"nextStation":"...","eta":"expected arrival time at next station","platform":"if shown",' +
      '"upcoming":[{"name":"station","sched":"scheduled time","eta":"expected time","delay":"e.g. 25 min"}] (max 6 rows),"note":"short extra info like cancelled / diverted / not running today"}');
    return {
      trainNo: no, source,
      trainName: j?.trainName || '',
      startDate: j?.startDate || '',
      currentStation: j?.currentStation || '',
      delayMin: j?.delayMin ?? null,
      status: j?.status || '',
      lastUpdated: j?.lastUpdated || '',
      eta: j?.eta || '',
      nextStation: j?.nextStation || '',
      platform: j?.platform || '',
      note: j?.note || '',
      upcoming: Array.isArray(j?.upcoming) ? j.upcoming.slice(0, 6) : [],
      raw: j ? '' : snippet.split('\n').slice(0, 30).join('\n'),
    };
  }

  // --- seat watch -------------------------------------------------------
  getWatches() { return this.store.get('trainWatches', []); }
  saveWatches(list) { this.store.set('trainWatches', list); }

  addWatch({ trainNo, trainName, from, to, date, cls, quota = 'GN' }) {
    if (!this.hasLiveData()) throw new Error('Seat watch needs live availability. Add a RapidAPI key in Settings → Travel first.');
    const f = resolveStation(from), t = resolveStation(to);
    if (!f || !t) throw new Error('Unknown station for the watch.');
    const parts = dateParts(parseDateInput(date));
    const c = normalizeClass(cls);
    if (!c) throw new Error('Class is required for a seat watch (e.g. SL, 3A).');
    const no = String(trainNo || '').replace(/\D/g, '');
    if (no.length !== 5) throw new Error('Train number must be 5 digits.');
    const list = this.getWatches();
    const dup = list.find((w) => w.active && w.trainNo === no && w.from === f.code && w.to === t.code && w.date === parts.ymd && w.cls === c);
    if (dup) return dup;
    const w = {
      id: `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      trainNo: no, trainName: trainName || '', from: f.code, to: t.code, date: parts.ymd, cls: c, quota,
      lastStatus: null, lastText: '', lastCheckedAt: null, createdAt: new Date().toISOString(), active: true, alertedAt: null,
    };
    list.push(w);
    this.saveWatches(list);
    // check right away in the background
    setTimeout(() => this.checkWatches(w.id).catch(() => {}), 500);
    return w;
  }

  removeWatch(id) {
    const list = this.getWatches();
    const kept = list.filter((w) => w.id !== id);
    this.saveWatches(kept);
    return { removed: list.length - kept.length };
  }

  async checkWatches(onlyId = null) {
    const list = this.getWatches();
    const today = dateParts(new Date()).ymd;
    let changed = false;
    for (const w of list) {
      if (!w.active) continue;
      if (onlyId && w.id !== onlyId) continue;
      if (w.date < today) { w.active = false; w.lastText = 'journey date passed'; changed = true; continue; }
      try {
        const a = await this.availability({ trainNo: w.trainNo, from: w.from, to: w.to, date: w.date, cls: w.cls, quota: w.quota });
        const prev = w.lastStatus;
        w.lastStatus = a.status; w.lastText = a.text; w.lastCheckedAt = a.checkedAt; w.probability = a.probability;
        changed = true;
        const good = a.status === 'available' || a.status === 'rac';
        const becameGood = good && prev !== a.status;
        if (becameGood || (good && !w.alertedAt)) {
          w.alertedAt = new Date().toISOString();
          await this.alert(w, a);
        }
      } catch (e) {
        w.lastText = `check failed: ${String(e.message).slice(0, 80)}`;
        w.lastCheckedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.saveWatches(list);
    this.emit('train-watches-updated', this.getWatches());
    return list;
  }

  async alert(w, a) {
    const title = a.status === 'available' ? '🎫 Seat available!' : '🟡 RAC available';
    const body = `${w.trainNo} ${w.trainName || ''} ${w.from}→${w.to} on ${w.date} (${w.cls}): ${a.text}. Book now!`;
    try {
      const { Notification } = require('electron');
      const n = new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'senju-icon.ico') });
      n.on('click', () => { try { this.openBooking({ from: w.from, to: w.to, date: w.date, cls: w.cls, site: 'irctc' }); } catch {} });
      n.show();
    } catch (e) { console.warn('[Trains] notification failed:', e.message); }
    this.emit('train-alert', { watch: w, availability: a, title, body });
    try {
      if (this.deps.whatsapp && this.deps.whatsapp.getWhatsAppState().state === 'connected') {
        await this.deps.whatsapp.sendMessage('myself', `${title}\n${body}\nIRCTC: https://www.irctc.co.in/nget/train-search`);
      }
    } catch (e) { console.warn('[Trains] WhatsApp alert failed:', e.message); }
  }

  emit(channel, payload) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload);
  }

  start(win) {
    this.window = win;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkWatches().catch((e) => console.warn('[Trains] watch check failed:', e.message)), WATCH_INTERVAL_MS);
    setTimeout(() => this.checkWatches().catch(() => {}), 15000);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // --- text formatting for the AI -----------------------------------------
  formatSearchForModel(r, limit = 8) {
    if (!r.count) {
      const hint = r.totalOnRoute ? `There are ${r.totalOnRoute} trains on this route on other days${r.cls ? ' or other classes' : ''}.` : 'No direct trains found on this route (try a nearby junction).';
      return `No direct trains ${r.from.code}→${r.to.code} on ${r.date} (${r.weekday})${r.cls ? ` with ${r.cls}` : ''}. ${hint}`;
    }
    const lines = r.trains.slice(0, limit).map((t) => {
      const fareTxt = r.cls
        ? `₹${t.fare ?? '?'}${t.vsAvgPct != null ? ` (${t.vsAvgPct > 0 ? '+' : ''}${t.vsAvgPct}% vs avg)` : ''}`
        : Object.entries(t.fares).sort((a, b) => a[1] - b[1]).map(([c, v]) => `${c} ₹${v}`).join(', ');
      const avail = t.availability ? ` | ${t.availability.text}${t.availability.probability ? ` (${t.availability.probability}% confirm)` : ''}` : '';
      const tags = t.tags.length ? ` [${t.tags.join(', ')}]` : '';
      return `- ${t.no} ${t.name} | dep ${t.dep} → arr ${t.arr}${t.arrDayOffset ? ` (+${t.arrDayOffset}d)` : ''} | ${t.duration} | ${fareTxt}${avail}${tags}`;
    });
    const sites = r.sites ? `\nSite totals for ₹${r.sites.fare} fare: ${r.sites.rows.map((s) => `${s.name} ₹${s.total}`).join(', ')}. ${r.sites.note}` : '';
    const more = r.count > limit ? `\n(+${r.count - limit} more trains; the Travel tab shows all)` : '';
    const avg = r.cls
      ? `Average ${r.cls} fare ₹${r.avgFare ?? '—'}.`
      : `Class averages: ${Object.entries(r.classAvg).map(([c, v]) => `${c} ₹${v.avg}`).join(', ')}.`;
    return `${r.count} trains ${r.from.name} (${r.from.code}) → ${r.to.name} (${r.to.code}) on ${r.date} (${r.weekday})${r.cls ? `, class ${r.cls}` : ''}. ${avg}\n${lines.join('\n')}${more}${sites}\n${r.availabilityNote || ''}\n${r.fareNote}`.trim();
  }
}

function classifyAvailability(text) {
  const s = String(text || '').toUpperCase();
  if (!s) return 'unknown';
  if (/AVAILABLE|AVL|CURR_AVBL/.test(s)) return 'available';
  if (/RAC/.test(s)) return 'rac';
  if (/WL|WAIT/.test(s)) return 'waitlist';
  if (/REGRET|NOT AVAILABLE|TRAIN DEPARTED|CANCEL/.test(s)) return 'regret';
  return 'unknown';
}

module.exports = { TrainAgent, resolveStation, stationSuggestions, parseErail, normalizeClass, SITES, CLASS_LABEL, DAY_SHORT };
