"""Seed data for the real company directory (top core-engineering employers in India).

Rules for this file:
* Facts are neutral and verifiable (official domain, headquarters, founding
  year, broad India presence, what the company does). Anything we are not sure
  of is left blank - never invented.
* No logos are stored. The UI shows the company's own site icon via its
  ``domain`` (with a monogram fallback).
* ``smartrecruiters_id`` is set only for boards the live sync already uses.
* ``live_source_names`` are the names live job sources use for the company,
  so their listings appear on the company's portfolio.

Bump SEED_VERSION whenever this list changes so existing databases refresh.
"""

SEED_VERSION = 1

M, C, EEE, ECE, CH, AE, AU, MT = "mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy"

COMPANIES = [
    {
        "slug": "bosch", "name": "Bosch", "domain": "bosch.com", "website": "https://www.bosch.in",
        "careers_url": "https://careers.smartrecruiters.com/BoschGroup",
        "industry": "Automotive & Industrial Technology", "branches": [M, EEE, ECE, AU],
        "hq": "Gerlingen, Germany", "india": ["Bengaluru", "Nashik", "Jaipur", "Coimbatore"], "founded": "1886",
        "about": "Bosch is a German engineering and technology company founded by Robert Bosch in 1886. "
                 "It works in mobility, industrial technology, consumer goods and energy and building technology. "
                 "In India it has manufacturing, engineering and software operations across several cities.",
        "smartrecruiters_id": "BoschGroup", "live_names": ["Bosch Group", "Robert Bosch", "Bosch Limited", "Bosch Global Software Technologies"],
    },
    {
        "slug": "siemens", "name": "Siemens", "domain": "siemens.com", "website": "https://www.siemens.com",
        "industry": "Industrial Automation & Electrification", "branches": [EEE, ECE, M],
        "hq": "Munich, Germany", "india": ["Mumbai", "Bengaluru", "Pune"], "founded": "1847",
        "about": "Siemens is a German technology company founded in 1847. "
                 "Its businesses cover industrial automation, smart infrastructure, mobility and digital industries. "
                 "Siemens Limited is its listed Indian company, headquartered in Mumbai.",
        "live_names": ["Siemens Limited", "Siemens AG"],
    },
    {
        "slug": "larsen-toubro", "name": "Larsen & Toubro", "domain": "larsentoubro.com", "website": "https://www.larsentoubro.com",
        "industry": "Engineering, Construction & Manufacturing", "branches": [C, M, EEE, ECE, CH, MT],
        "hq": "Mumbai, India", "india": ["Mumbai", "Chennai", "Vadodara", "Hazira"], "founded": "1938",
        "about": "Larsen & Toubro (L&T) is an Indian multinational founded in Mumbai in 1938. "
                 "It works in engineering and construction, heavy manufacturing, energy and defence projects. "
                 "It is one of India's largest engineering and construction companies.",
        "live_names": ["L&T", "Larsen and Toubro", "L&T Construction"],
    },
    {
        "slug": "tata-motors", "name": "Tata Motors", "domain": "tatamotors.com", "website": "https://www.tatamotors.com",
        "industry": "Automotive", "branches": [M, AU, EEE, MT],
        "hq": "Mumbai, India", "india": ["Pune", "Jamshedpur", "Lucknow", "Sanand"], "founded": "1945",
        "about": "Tata Motors is an Indian automobile manufacturer and part of the Tata Group. "
                 "It makes passenger vehicles, electric vehicles and commercial vehicles. "
                 "Its major Indian plants include Pune, Jamshedpur, Lucknow and Sanand.",
        "live_names": ["Tata Motors Limited"],
    },
    {
        "slug": "mahindra", "name": "Mahindra & Mahindra", "domain": "mahindra.com", "website": "https://www.mahindra.com",
        "industry": "Automotive & Farm Equipment", "branches": [M, AU, EEE, MT],
        "hq": "Mumbai, India", "india": ["Mumbai", "Chennai", "Pune", "Nashik"], "founded": "1945",
        "about": "Mahindra & Mahindra is an Indian company in the Mahindra Group, founded in 1945. "
                 "It makes utility vehicles, commercial vehicles and tractors. "
                 "Its research centre, Mahindra Research Valley, is near Chennai.",
        "live_names": ["Mahindra and Mahindra", "Mahindra Group"],
    },
    {
        "slug": "bharat-electronics", "name": "Bharat Electronics (BEL)", "domain": "bel-india.in", "website": "https://bel-india.in",
        "industry": "Defence Electronics (PSU)", "branches": [ECE, EEE, M],
        "hq": "Bengaluru, India", "india": ["Bengaluru", "Ghaziabad", "Pune", "Hyderabad", "Chennai"], "founded": "1954",
        "about": "Bharat Electronics Limited (BEL) is a public sector company under India's Ministry of Defence, set up in 1954. "
                 "It designs and manufactures electronic systems such as radars, communication equipment and electro-optics. "
                 "It recruits engineers through its own notified recruitment drives.",
        "live_names": ["Bharat Electronics Limited", "BEL"],
    },
    {
        "slug": "hal", "name": "Hindustan Aeronautics (HAL)", "domain": "hal-india.co.in", "website": "https://hal-india.co.in",
        "industry": "Aerospace & Defence (PSU)", "branches": [AE, M, EEE, ECE, MT],
        "hq": "Bengaluru, India", "india": ["Bengaluru", "Nashik", "Koraput", "Lucknow", "Kanpur", "Hyderabad"], "founded": "1940",
        "about": "Hindustan Aeronautics Limited (HAL) is a public sector aerospace and defence company under the Ministry of Defence. "
                 "It designs, manufactures and overhauls aircraft, helicopters and aero-engines. "
                 "Its origins go back to Hindustan Aircraft, set up in Bengaluru in 1940.",
        "live_names": ["Hindustan Aeronautics Limited", "HAL"],
    },
    {
        "slug": "isro", "name": "ISRO", "domain": "isro.gov.in", "website": "https://www.isro.gov.in",
        "industry": "Space Research (Government)", "branches": [AE, M, ECE, EEE],
        "hq": "Bengaluru, India", "india": ["Bengaluru", "Thiruvananthapuram", "Sriharikota", "Ahmedabad"], "founded": "1969",
        "about": "The Indian Space Research Organisation (ISRO) is India's national space agency under the Department of Space, formed in 1969. "
                 "It develops launch vehicles, satellites and space applications. "
                 "Scientists and engineers are recruited through its centralised recruitment board.",
        "live_names": ["Indian Space Research Organisation"],
    },
    {
        "slug": "ntpc", "name": "NTPC", "domain": "ntpc.co.in", "website": "https://www.ntpc.co.in",
        "industry": "Power Generation (PSU)", "branches": [EEE, M, C, ECE],
        "hq": "New Delhi, India", "india": ["New Delhi", "Noida"], "founded": "1975",
        "about": "NTPC Limited is a public sector power generation company under India's Ministry of Power, set up in 1975. "
                 "It operates thermal, hydro and renewable power stations across India. "
                 "It recruits engineering graduates as Engineering Executive Trainees.",
        "live_names": ["NTPC Limited"],
    },
    {
        "slug": "bhel", "name": "BHEL", "domain": "bhel.com", "website": "https://www.bhel.com",
        "industry": "Power & Industrial Equipment (PSU)", "branches": [M, EEE, ECE, MT],
        "hq": "New Delhi, India", "india": ["Haridwar", "Bhopal", "Tiruchirappalli", "Hyderabad", "Bengaluru"], "founded": "1964",
        "about": "Bharat Heavy Electricals Limited (BHEL) is a public sector engineering and manufacturing company. "
                 "It makes equipment for power generation, transmission, transportation and industry. "
                 "Its large manufacturing units include Haridwar, Bhopal and Tiruchirappalli.",
        "live_names": ["Bharat Heavy Electricals Limited"],
    },
    {
        "slug": "ongc", "name": "ONGC", "domain": "ongcindia.com", "website": "https://ongcindia.com",
        "industry": "Oil & Gas Exploration (PSU)", "branches": [CH, M, EEE, ECE],
        "hq": "New Delhi, India", "india": ["New Delhi", "Dehradun", "Mumbai", "Vadodara"], "founded": "1956",
        "about": "Oil and Natural Gas Corporation (ONGC) is a public sector company under India's Ministry of Petroleum and Natural Gas. "
                 "It explores for and produces crude oil and natural gas in India and abroad. "
                 "It was set up in 1956.",
        "live_names": ["Oil and Natural Gas Corporation"],
    },
    {
        "slug": "reliance-industries", "name": "Reliance Industries", "domain": "ril.com", "website": "https://www.ril.com",
        "industry": "Energy, Petrochemicals & Materials", "branches": [CH, M, EEE, C],
        "hq": "Mumbai, India", "india": ["Mumbai", "Jamnagar", "Navi Mumbai"],
        "about": "Reliance Industries Limited is an Indian conglomerate headquartered in Mumbai. "
                 "Its businesses include oil-to-chemicals, retail, digital services and new energy. "
                 "It operates a large refining and petrochemicals complex at Jamnagar, Gujarat.",
        "live_names": ["Reliance Industries Limited", "RIL"],
    },
    {
        "slug": "tata-steel", "name": "Tata Steel", "domain": "tatasteel.com", "website": "https://www.tatasteel.com",
        "industry": "Steel & Metals", "branches": [MT, M, EEE, CH],
        "hq": "Mumbai, India", "india": ["Jamshedpur", "Kalinganagar", "Kolkata"], "founded": "1907",
        "about": "Tata Steel is a steel company in the Tata Group, founded in 1907. "
                 "Its first integrated steel plant is in Jamshedpur, Jharkhand. "
                 "It makes flat and long steel products for automotive, construction and engineering customers.",
        "live_names": ["Tata Steel Limited"],
    },
    {
        "slug": "jsw-steel", "name": "JSW Steel", "domain": "jsw.in", "website": "https://www.jsw.in",
        "industry": "Steel & Metals", "branches": [MT, M, EEE, CH],
        "hq": "Mumbai, India", "india": ["Vijayanagar (Ballari)", "Dolvi", "Salem"],
        "about": "JSW Steel is the steel business of the JSW Group, headquartered in Mumbai. "
                 "It makes flat and long steel products. "
                 "Its largest plant is at Vijayanagar in Karnataka.",
        "live_names": ["JSW Steel Limited", "JSW Group"],
    },
    {
        "slug": "continental", "name": "Continental", "domain": "continental.com", "website": "https://www.continental.com",
        "careers_url": "https://careers.smartrecruiters.com/Continental",
        "industry": "Automotive Supplier & Tyres", "branches": [AU, M, ECE, EEE, CH],
        "hq": "Hanover, Germany", "india": ["Bengaluru", "Gurugram", "Pune"], "founded": "1871",
        "about": "Continental is a German company founded in Hanover in 1871. "
                 "It is known for tyres and technologies for vehicles and industry. "
                 "It has engineering and manufacturing operations in India.",
        "smartrecruiters_id": "Continental", "live_names": ["Continental AG"],
    },
    {
        "slug": "wabtec", "name": "Wabtec", "domain": "wabteccorp.com", "website": "https://www.wabteccorp.com",
        "careers_url": "https://careers.smartrecruiters.com/Wabtec",
        "industry": "Rail Technology", "branches": [M, EEE, ECE],
        "hq": "Pittsburgh, USA", "india": ["Bengaluru"],
        "about": "Wabtec (Westinghouse Air Brake Technologies) is a US company headquartered in Pittsburgh. "
                 "It makes locomotives, rail equipment and digital systems for freight and transit rail. "
                 "It has engineering and manufacturing operations in India.",
        "smartrecruiters_id": "Wabtec", "live_names": ["Wabtec Corporation", "Westinghouse Air Brake Technologies"],
    },
    {
        "slug": "abb", "name": "ABB", "domain": "abb.com", "website": "https://www.abb.com",
        "industry": "Electrification & Automation", "branches": [EEE, ECE, M],
        "hq": "Zurich, Switzerland", "india": ["Bengaluru", "Vadodara", "Nashik"], "founded": "1988",
        "about": "ABB is a Swiss-Swedish technology company formed in 1988 by the merger of ASEA and BBC. "
                 "It works in electrification, motion, process automation and robotics. "
                 "ABB India Limited is headquartered in Bengaluru.",
        "live_names": ["ABB India", "ABB Ltd"],
    },
    {
        "slug": "schneider-electric", "name": "Schneider Electric", "domain": "se.com", "website": "https://www.se.com",
        "industry": "Energy Management & Automation", "branches": [EEE, ECE],
        "hq": "Rueil-Malmaison, France", "india": ["Bengaluru"], "founded": "1836",
        "about": "Schneider Electric is a French company working in energy management and industrial automation. "
                 "Its products include electrical distribution equipment, automation systems and software. "
                 "It has manufacturing and R&D operations in India.",
        "live_names": ["Schneider Electric India"],
    },
    {
        "slug": "honeywell", "name": "Honeywell", "domain": "honeywell.com", "website": "https://www.honeywell.com",
        "industry": "Aerospace, Automation & Materials", "branches": [AE, EEE, ECE, CH, M],
        "hq": "Charlotte, USA", "india": ["Bengaluru", "Hyderabad", "Pune", "Gurugram"],
        "about": "Honeywell is a US industrial technology company headquartered in Charlotte, North Carolina. "
                 "It works in aerospace, building automation, industrial automation and performance materials. "
                 "It has large engineering centres in India.",
        "live_names": ["Honeywell International"],
    },
    {
        "slug": "cummins", "name": "Cummins", "domain": "cummins.com", "website": "https://www.cummins.com",
        "industry": "Engines & Power Systems", "branches": [M, AU, EEE],
        "hq": "Columbus, Indiana, USA", "india": ["Pune"], "founded": "1919",
        "about": "Cummins is a US company founded in 1919 that designs and manufactures engines, power generation and filtration products. "
                 "It also develops electrified and hydrogen power technologies. "
                 "Its Indian operations are centred in Pune.",
        "live_names": ["Cummins India", "Cummins Inc"],
    },
    {
        "slug": "ashok-leyland", "name": "Ashok Leyland", "domain": "ashokleyland.com", "website": "https://www.ashokleyland.com",
        "industry": "Commercial Vehicles", "branches": [AU, M, EEE],
        "hq": "Chennai, India", "india": ["Chennai", "Hosur", "Alwar", "Pantnagar"], "founded": "1948",
        "about": "Ashok Leyland is an Indian commercial vehicle manufacturer in the Hinduja Group, headquartered in Chennai. "
                 "It makes trucks, buses and light commercial vehicles. "
                 "It was founded in 1948.",
        "live_names": ["Ashok Leyland Limited"],
    },
    {
        "slug": "maruti-suzuki", "name": "Maruti Suzuki", "domain": "marutisuzuki.com", "website": "https://www.marutisuzuki.com",
        "industry": "Automotive", "branches": [AU, M, EEE, MT],
        "hq": "New Delhi, India", "india": ["Gurugram", "Manesar", "Rohtak"], "founded": "1981",
        "about": "Maruti Suzuki India Limited is a passenger car manufacturer and a subsidiary of Suzuki Motor Corporation. "
                 "It was incorporated in 1981. "
                 "Its manufacturing is in Haryana, and its R&D centre is at Rohtak.",
        "live_names": ["Maruti Suzuki India", "Maruti Suzuki India Limited"],
    },
    {
        "slug": "hyundai-motor-india", "name": "Hyundai Motor India", "domain": "hyundai.com", "website": "https://www.hyundai.com/in",
        "industry": "Automotive", "branches": [AU, M, EEE],
        "hq": "Chennai, India", "india": ["Chennai", "Hyderabad"], "founded": "1996",
        "about": "Hyundai Motor India Limited is the Indian subsidiary of South Korea's Hyundai Motor Company, set up in 1996. "
                 "It makes passenger cars at its plant near Chennai. "
                 "It also has an engineering centre in Hyderabad.",
        "live_names": ["Hyundai Motor India Limited", "Hyundai Motor India Engineering"],
    },
    {
        "slug": "texas-instruments", "name": "Texas Instruments", "domain": "ti.com", "website": "https://www.ti.com",
        "industry": "Semiconductors", "branches": [ECE, EEE],
        "hq": "Dallas, USA", "india": ["Bengaluru"], "founded": "1930",
        "about": "Texas Instruments (TI) is a US semiconductor company headquartered in Dallas, Texas. "
                 "It designs and makes analog and embedded processing chips. "
                 "Its India R&D centre in Bengaluru opened in 1985.",
        "live_names": ["Texas Instruments India"],
    },
    {
        "slug": "qualcomm", "name": "Qualcomm", "domain": "qualcomm.com", "website": "https://www.qualcomm.com",
        "industry": "Semiconductors & Wireless", "branches": [ECE, EEE],
        "hq": "San Diego, USA", "india": ["Bengaluru", "Hyderabad", "Chennai"], "founded": "1985",
        "about": "Qualcomm is a US semiconductor and wireless technology company founded in 1985 in San Diego. "
                 "It designs processors and modems for mobile, automotive and IoT devices. "
                 "It has large engineering centres in India.",
        "live_names": ["Qualcomm India"],
    },
    {
        "slug": "intel", "name": "Intel", "domain": "intel.com", "website": "https://www.intel.com",
        "industry": "Semiconductors", "branches": [ECE, EEE],
        "hq": "Santa Clara, USA", "india": ["Bengaluru", "Hyderabad"], "founded": "1968",
        "about": "Intel is a US semiconductor company founded in 1968 and headquartered in Santa Clara, California. "
                 "It designs and manufactures processors and other chips. "
                 "Intel India has design and engineering centres in Bengaluru and Hyderabad.",
        "live_names": ["Intel Corporation", "Intel India"],
    },
    {
        "slug": "ge-aerospace", "name": "GE Aerospace", "domain": "geaerospace.com", "website": "https://www.geaerospace.com",
        "industry": "Aerospace", "branches": [AE, M, MT],
        "hq": "Evendale, Ohio, USA", "india": ["Bengaluru", "Pune"],
        "about": "GE Aerospace is a US company that makes jet and turboprop engines and aircraft systems. "
                 "It became a standalone company in 2024 after General Electric's separation. "
                 "In India it has an engineering centre in Bengaluru and a manufacturing facility in Pune.",
        "live_names": ["GE Aerospace India"],
    },
    {
        "slug": "airbus", "name": "Airbus", "domain": "airbus.com", "website": "https://www.airbus.com",
        "industry": "Aerospace", "branches": [AE, M, EEE],
        "hq": "Leiden, Netherlands (registered); Toulouse, France", "india": ["Bengaluru"], "founded": "1970",
        "about": "Airbus is a European aerospace company that designs and makes commercial aircraft, helicopters, defence and space systems. "
                 "Its commercial aircraft business is based in Toulouse, France. "
                 "It has an engineering and technology centre in Bengaluru.",
        "live_names": ["Airbus India"],
    },
    {
        "slug": "godrej-boyce", "name": "Godrej & Boyce", "domain": "godrejandboyce.com", "website": "https://www.godrejandboyce.com",
        "industry": "Engineering & Manufacturing", "branches": [M, AE, EEE, C],
        "hq": "Mumbai, India", "india": ["Mumbai"], "founded": "1897",
        "about": "Godrej & Boyce is an Indian manufacturing company of the Godrej Group, founded in 1897 and based at Vikhroli, Mumbai. "
                 "Its businesses include precision engineering, aerospace components, process equipment and construction. "
                 "It is one of India's oldest engineering companies.",
        "live_names": ["Godrej and Boyce", "Godrej & Boyce Mfg. Co."],
    },
    {
        "slug": "thermax", "name": "Thermax", "domain": "thermaxglobal.com", "website": "https://www.thermaxglobal.com",
        "industry": "Energy & Environment Engineering", "branches": [M, CH, EEE],
        "hq": "Pune, India", "india": ["Pune"],
        "about": "Thermax is an Indian engineering company headquartered in Pune. "
                 "It makes boilers, heating and cooling systems, water and air pollution control equipment and chemicals. "
                 "It also builds energy and environment projects.",
        "live_names": ["Thermax Limited"],
    },
    {
        "slug": "indian-oil", "name": "Indian Oil Corporation", "domain": "iocl.com", "website": "https://iocl.com",
        "industry": "Oil Refining & Marketing (PSU)", "branches": [CH, M, EEE, ECE],
        "hq": "New Delhi, India", "india": ["New Delhi", "Panipat", "Guwahati", "Mathura"], "founded": "1959",
        "about": "Indian Oil Corporation (IndianOil) is a public sector oil company under the Ministry of Petroleum and Natural Gas. "
                 "It refines crude oil and markets fuels and petrochemicals across India. "
                 "It operates refineries including Panipat, Mathura and Guwahati.",
        "live_names": ["IndianOil", "Indian Oil Corporation Limited", "IOCL"],
    },
    {
        "slug": "tata-power", "name": "Tata Power", "domain": "tatapower.com", "website": "https://www.tatapower.com",
        "industry": "Power & Renewables", "branches": [EEE, M, C],
        "hq": "Mumbai, India", "india": ["Mumbai"],
        "about": "Tata Power is an integrated power company in the Tata Group, headquartered in Mumbai. "
                 "It works in power generation, transmission, distribution, solar manufacturing and EV charging. "
                 "It operates thermal, hydro and renewable power assets in India.",
        "live_names": ["Tata Power Company", "Tata Power Company Limited"],
    },
    {
        "slug": "ultratech-cement", "name": "UltraTech Cement", "domain": "ultratechcement.com", "website": "https://www.ultratechcement.com",
        "industry": "Cement & Building Materials", "branches": [C, CH, M, EEE],
        "hq": "Mumbai, India", "india": ["Mumbai"],
        "about": "UltraTech Cement is the cement company of the Aditya Birla Group, headquartered in Mumbai. "
                 "It makes grey cement, ready-mix concrete and building products. "
                 "It operates integrated cement plants and grinding units across India.",
        "live_names": ["UltraTech Cement Limited"],
    },
]
