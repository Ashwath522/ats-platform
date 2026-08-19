"""
Curated skills vocabulary used for fast keyword-level gap detection.

Keep canonical names in one place and add aliases only when they are specific
enough to avoid noisy matches. Short generic aliases such as "cad" are avoided
because they produce false positives in ordinary prose.
"""

SOFTWARE_SKILLS = [
    "Accounting", "Agile", "Airflow", "Angular", "Apache Beam", "Apache Flink", "AWS", "Azure",
    "BigQuery", "CI/CD", "CNN", "Computer Vision", "CSS", "Data Pipelines", "Data Science",
    "Databricks", "dbt", "Deep Learning", "Django", "Docker", "Elasticsearch", "Embeddings",
    "ETL", "Excel", "FAISS", "FastAPI", "Feature Engineering", "Figma", "Flask", "Forecasting",
    "GANs", "GCP", "Go", "GraphQL", "gRPC", "Hadoop", "HTML", "Hugging Face Transformers",
    "Illustrator", "Image Classification", "Information Retrieval", "Java", "JavaScript",
    "Kafka", "Kubernetes", "LangChain", "LLMs", "Machine Learning", "Marketing", "Microservices",
    "MLOps", "MongoDB", "Natural Language Processing", "Next.js", "NLP", "Node.js",
    "Object Detection", "OpenCV", "PostgreSQL", "PowerPoint", "Project Management",
    "Prompt Engineering", "Python", "PyTorch", "RAG", "React", "Recommendation Systems",
    "Redis", "Redux", "Reinforcement Learning", "REST APIs", "Rust", "Sales", "Salesforce CRM",
    "SAP", "Scikit-Learn", "Scrum", "SEO", "Six Sigma", "Snowflake", "Spark",
    "Speech Recognition", "Spring Boot", "SQL", "Statistical Modeling", "Tailwind", "Tally",
    "TensorFlow", "Terraform", "Time Series", "TypeScript", "Vector Search", "Vue.js",
    "Weaviate", "Webpack",
]

BUSINESS_SKILLS = [
    "Corporate Finance", "Digital Marketing", "Employee Engagement", "IFRS", "Invoicing",
    "Marketing Automation", "Marketing Strategy", "Operations Management", "Public Relations", "SEM",
]

MECHANICAL_SKILLS = [
    "3D Printing", "Additive Manufacturing", "ANSYS", "AutoCAD", "CAD/CAM", "CATIA", "CNC Machining",
    "DFA (Design for Assembly)", "DFM (Design for Manufacturing)", "FEA (Finite Element Analysis)",
    "Fluid Mechanics", "GD&T", "HVAC", "Injection Molding", "Kinematics", "Lean Manufacturing",
    "Manufacturing Processes", "Materials Science", "MATLAB", "Mechanical Design",
    "Product Lifecycle Management (PLM)", "Root Cause Analysis", "Sheet Metal Design",
    "SolidWorks", "Thermodynamics", "Tolerance Analysis", "Welding",
]

CIVIL_SKILLS = [
    "AutoCAD Civil 3D", "BIM (Building Information Modeling)", "Building Codes", "Concrete Design",
    "Construction Management", "Environmental Engineering", "ETABS", "Geotechnical Engineering",
    "Highway Engineering", "Hydraulics", "Land Surveying", "MS Project", "Primavera P6",
    "Project Estimation", "Quantity Surveying", "Reinforced Concrete Design", "Revit",
    "Site Supervision", "Soil Mechanics", "STAAD Pro", "Steel Design", "Structural Analysis",
    "Structural Design", "Surveying", "Water Resources Engineering",
]

ECE_SKILLS = [
    "5G/4G/LTE", "Altium Designer", "Analog Circuit Design", "Antenna Design", "ARM Cortex",
    "Circuit Simulation (SPICE)", "Communication Protocols", "Control Systems", "Digital Circuit Design",
    "Digital Signal Processing (DSP)", "Embedded C", "Embedded Systems", "FPGA", "IoT (Internet of Things)",
    "MATLAB/Simulink", "Microcontrollers", "Oscilloscope/Multimeter", "PCB Design", "PCB Layout",
    "RF Design", "Signal Processing", "Verilog", "VHDL", "VLSI", "Wireless Communication",
]

EEE_SKILLS = [
    "AutoCAD Electrical", "Electrical Circuit Design", "Electrical Machines", "Electrical Safety Standards",
    "HVDC", "Instrumentation", "Load Flow Analysis", "Motors and Drives", "PLC Programming",
    "Power Electronics", "Power System Protection", "Power Systems", "Relay Coordination",
    "Renewable Energy Systems", "SCADA", "SCADA/HMI", "Solar PV Design", "Switchgear",
    "Transformers", "Variable Frequency Drives (VFD)",
]

AEROSPACE_SKILLS = [
    "Aerodynamic Design", "Aerodynamics", "Aerospace Systems Design", "Aircraft Structures",
    "Airworthiness", "Avionics", "Composite Materials", "Flight Mechanics", "Flight Testing",
    "Fluid Dynamics (CFD)", "Gas Turbine Engines", "Orbital Mechanics", "Propulsion Systems",
    "Rocket Propulsion", "Satellite Systems", "Systems Engineering",
]

KNOWN_SKILLS = list(dict.fromkeys(
    SOFTWARE_SKILLS
    + BUSINESS_SKILLS
    + MECHANICAL_SKILLS
    + CIVIL_SKILLS
    + ECE_SKILLS
    + EEE_SKILLS
    + AEROSPACE_SKILLS
))

SKILL_ALIASES = {
    "8051": "Microcontrollers",
    "additive manufacturing": "Additive Manufacturing",
    "arm": "ARM Cortex",
    "autocad civil3d": "AutoCAD Civil 3D",
    "bim": "BIM (Building Information Modeling)",
    "cad cam": "CAD/CAM",
    "cfd": "Fluid Dynamics (CFD)",
    "dfa": "DFA (Design for Assembly)",
    "dfm": "DFM (Design for Manufacturing)",
    "dsp": "Digital Signal Processing (DSP)",
    "embedded c": "Embedded C",
    "fea": "FEA (Finite Element Analysis)",
    "gd and t": "GD&T",
    "gdt": "GD&T",
    "lte": "5G/4G/LTE",
    "matlab simulink": "MATLAB/Simulink",
    "ms project": "MS Project",
    "pic": "Microcontrollers",
    "plc": "PLC Programming",
    "plm": "Product Lifecycle Management (PLM)",
    "primavera": "Primavera P6",
    "scada hmi": "SCADA/HMI",
    "spice": "Circuit Simulation (SPICE)",
    "spi": "Communication Protocols",
    "staad": "STAAD Pro",
    "uart": "Communication Protocols",
    "vfd": "Variable Frequency Drives (VFD)",
}

KNOWN_SKILLS_LOWER = {s.lower(): s for s in KNOWN_SKILLS}
