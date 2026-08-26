"""
Curated skills vocabulary used for fast keyword-level gap detection.

Keep canonical names in one place and add aliases only when they are specific
enough to avoid noisy matches. Short generic aliases such as "cad" are avoided
because they produce false positives in ordinary prose.
"""

SOFTWARE_SKILLS = [
    # Languages
    "Python", "JavaScript", "TypeScript", "Java", "Go", "Kotlin", "Swift", "Rust",
    "C++", "C#", "Ruby", "PHP", "Scala", "R", "MATLAB", "Dart", "Elixir",
    # Frontend
    "React", "Next.js", "Vue.js", "Angular", "Svelte", "Astro", "HTML", "CSS",
    "Tailwind", "Redux", "Webpack", "Vite",
    # Backend / APIs
    "FastAPI", "Django", "Flask", "Spring Boot", "Node.js", "Express.js", "GraphQL",
    "REST APIs", "gRPC", "tRPC", "Pydantic", "SQLAlchemy",
    # Data / ML
    "Machine Learning", "Deep Learning", "NLP", "Natural Language Processing",
    "Computer Vision", "CNN", "GANs", "Reinforcement Learning",
    "Feature Engineering", "Statistical Modeling", "Time Series", "Forecasting",
    "Scikit-Learn", "TensorFlow", "PyTorch", "Hugging Face Transformers",
    "LLMs", "Prompt Engineering", "RAG", "LangChain", "LangGraph", "CrewAI",
    "Embeddings", "Vector Search", "FAISS", "Pinecone", "Qdrant", "Weaviate",
    "Data Science", "Data Pipelines", "ETL", "Apache Beam", "Apache Flink",
    "Spark", "Hadoop", "Kafka", "Airflow", "dbt",
    "BigQuery", "Snowflake", "Databricks", "Elasticsearch",
    "Recommendation Systems", "Image Classification", "Object Detection",
    "Speech Recognition", "Information Retrieval",
    "OpenCV", "MLOps",
    # Cloud / DevOps
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible",
    "Pulumi", "CI/CD", "GitHub Actions", "GitLab CI", "Jenkins", "ArgoCD",
    "Prometheus", "Grafana", "OpenTelemetry", "Nginx", "Traefik",
    "Microservices",
    # Databases
    "SQL", "PostgreSQL", "MongoDB", "Redis", "Supabase",
    # Testing
    "Playwright", "Cypress", "Jest", "Vitest", "Pytest", "Storybook",
    # Design / Tooling
    "Figma", "Illustrator", "Sketch", "Zeplin",
    "Excel", "PowerPoint", "Agile", "Scrum", "Jira", "Linear", "Notion",
    # Other software
    "SEO", "Marketing", "Sales", "Salesforce CRM", "SAP",
    "Accounting", "Tally", "Six Sigma", "Project Management",
]

BUSINESS_SKILLS = [
    "Corporate Finance", "Digital Marketing", "Employee Engagement", "IFRS", "Invoicing",
    "Marketing Automation", "Marketing Strategy", "Operations Management",
    "Public Relations", "SEM", "B2B SaaS", "Product Management",
    "OKRs", "KPIs", "Stakeholder Management", "Agile Coaching", "Lean Six Sigma",
    "Business Analysis", "Data Analytics", "Power BI", "Tableau", "Looker",
]

MECHANICAL_SKILLS = [
    "3D Printing", "Additive Manufacturing", "ANSYS", "AutoCAD", "CAD/CAM",
    "CATIA", "CNC Machining", "DFA (Design for Assembly)", "DFM (Design for Manufacturing)",
    "FEA (Finite Element Analysis)", "Fluid Mechanics", "GD&T", "HVAC",
    "Injection Molding", "Kinematics", "Lean Manufacturing", "Manufacturing Processes",
    "Materials Science", "Mechanical Design", "Product Lifecycle Management (PLM)",
    "Root Cause Analysis", "Sheet Metal Design", "SolidWorks", "Thermodynamics",
    "Tolerance Analysis", "Welding",
]

CIVIL_SKILLS = [
    "AutoCAD Civil 3D", "BIM (Building Information Modeling)", "Building Codes",
    "Concrete Design", "Construction Management", "Environmental Engineering", "ETABS",
    "Geotechnical Engineering", "Highway Engineering", "Hydraulics", "Land Surveying",
    "MS Project", "Primavera P6", "Project Estimation", "Quantity Surveying",
    "Reinforced Concrete Design", "Revit", "Site Supervision", "Soil Mechanics",
    "STAAD Pro", "Steel Design", "Structural Analysis", "Structural Design",
    "Surveying", "Water Resources Engineering",
]

ECE_SKILLS = [
    "5G/4G/LTE", "Altium Designer", "Analog Circuit Design", "Antenna Design",
    "ARM Cortex", "Circuit Simulation (SPICE)", "Communication Protocols",
    "Control Systems", "Digital Circuit Design", "Digital Signal Processing (DSP)",
    "Embedded C", "Embedded Systems", "FPGA", "IoT (Internet of Things)",
    "MATLAB/Simulink", "Microcontrollers", "Oscilloscope/Multimeter", "PCB Design",
    "PCB Layout", "RF Design", "Signal Processing", "Verilog", "VHDL", "VLSI",
    "Wireless Communication",
]

EEE_SKILLS = [
    "AutoCAD Electrical", "Electrical Circuit Design", "Electrical Machines",
    "Electrical Safety Standards", "HVDC", "Instrumentation", "Load Flow Analysis",
    "Motors and Drives", "PLC Programming", "Power Electronics",
    "Power System Protection", "Power Systems", "Relay Coordination",
    "Renewable Energy Systems", "SCADA", "SCADA/HMI", "Solar PV Design",
    "Switchgear", "Transformers", "Variable Frequency Drives (VFD)",
]

AEROSPACE_SKILLS = [
    "Aerodynamic Design", "Aerodynamics", "Aerospace Systems Design", "Aircraft Structures",
    "Airworthiness", "Avionics", "Composite Materials", "Flight Mechanics",
    "Flight Testing", "Fluid Dynamics (CFD)", "Gas Turbine Engines",
    "Orbital Mechanics", "Propulsion Systems", "Rocket Propulsion",
    "Satellite Systems", "Systems Engineering",
]

CHEMICAL_SKILLS = [
    "Process Design", "Mass Transfer", "Heat Transfer", "Reaction Engineering",
    "Distillation", "Absorption", "P&ID", "PFD", "Aspen Plus", "HYSYS", 
    "HAZOP", "LOPA", "PSD", "Pumps", "Compressors", "Heat Exchangers", 
    "Reactors", "DCS", "Material Balance", "Energy Balance",
    "Process Safety Management (PSM)", "Environmental Compliance", "SOPs"
]

KNOWN_SKILLS = list(dict.fromkeys(
    SOFTWARE_SKILLS
    + BUSINESS_SKILLS
    + MECHANICAL_SKILLS
    + CIVIL_SKILLS
    + ECE_SKILLS
    + EEE_SKILLS
    + AEROSPACE_SKILLS
    + CHEMICAL_SKILLS
))

BRANCH_SKILLS = {
    "software": SOFTWARE_SKILLS + BUSINESS_SKILLS,
    "mechanical": MECHANICAL_SKILLS + BUSINESS_SKILLS,
    "civil": CIVIL_SKILLS + BUSINESS_SKILLS,
    "ece": ECE_SKILLS + BUSINESS_SKILLS,
    "eee": EEE_SKILLS + BUSINESS_SKILLS,
    "aerospace": AEROSPACE_SKILLS + BUSINESS_SKILLS,
    "chemical": CHEMICAL_SKILLS + BUSINESS_SKILLS,
}

SKILL_ALIASES = {
    # Microcontrollers
    "8051": "Microcontrollers",
    "pic": "Microcontrollers",
    "avr": "Microcontrollers",
    "arm": "ARM Cortex",
    # Engineering aliases
    "additive manufacturing": "Additive Manufacturing",
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
    "5g": "5G/4G/LTE",
    "matlab simulink": "MATLAB/Simulink",
    "ms project": "MS Project",
    "plc": "PLC Programming",
    "plm": "Product Lifecycle Management (PLM)",
    "primavera": "Primavera P6",
    "scada hmi": "SCADA/HMI",
    "spice": "Circuit Simulation (SPICE)",
    "spi": "Communication Protocols",
    "i2c": "Communication Protocols",
    "uart": "Communication Protocols",
    "can bus": "Communication Protocols",
    "staad": "STAAD Pro",
    "etabs": "ETABS",
    "revit": "Revit",
    "solidworks": "SolidWorks",
    "ansys": "ANSYS",
    "quantity surveying": "Quantity Surveying",
    "hvac": "HVAC",
    "vfd": "Variable Frequency Drives (VFD)",
    # Software / cloud aliases
    "k8s": "Kubernetes",
    "kube": "Kubernetes",
    "tf": "Terraform",
    "hcl": "Terraform",
    "gha": "GitHub Actions",
    "gh actions": "GitHub Actions",
    "gitlab ci": "GitLab CI",
    "github actions": "GitHub Actions",
    "node": "Node.js",
    "nodejs": "Node.js",
    "express": "Express.js",
    "expressjs": "Express.js",
    "pg": "PostgreSQL",
    "postgres": "PostgreSQL",
    "mongo": "MongoDB",
    "ts": "TypeScript",
    "js": "JavaScript",
    "py": "Python",
    "golang": "Go",
    "langchain": "LangChain",
    "langgraph": "LangGraph",
    "nextjs": "Next.js",
    "vuejs": "Vue.js",
    "nuxt": "Vue.js",
    "sklearn": "Scikit-Learn",
    "scikit learn": "Scikit-Learn",
    "hf": "Hugging Face Transformers",
    "huggingface": "Hugging Face Transformers",
    "rag pipeline": "RAG",
    "retrieval augmented generation": "RAG",
    "large language models": "LLMs",
    "llm": "LLMs",
    "ci cd": "CI/CD",
    "devops": "CI/CD",
    "aws lambda": "AWS",
    "ec2": "AWS",
    "s3": "AWS",
    "gke": "GCP",
    "gcs": "GCP",
    "azure devops": "Azure",
    "azureml": "Azure",
    "iot": "IoT (Internet of Things)",
    "power bi": "Power BI",
    "powerbi": "Power BI",
    "tableau": "Tableau",
    "looker studio": "Looker",
    "dbt core": "dbt",
    "apache kafka": "Kafka",
    "apache spark": "Spark",
    "elasticsearch": "Elasticsearch",
    "elastic search": "Elasticsearch",
    "faiss": "FAISS",
    "chromadb": "Vector Search",
    "vector db": "Vector Search",
    "pinecone": "Pinecone",
    "qdrant": "Qdrant",
    "weaviate": "Weaviate",
    "opentelemetry": "OpenTelemetry",
    "otel": "OpenTelemetry",
    "prometheus": "Prometheus",
    "grafana": "Grafana",
    "ansible": "Ansible",
    "argocd": "ArgoCD",
    "vite": "Vite",
    "vitest": "Vitest",
    "playwright": "Playwright",
    "cypress": "Cypress",
    "jest": "Jest",
    "pytest": "Pytest",
    "storybook": "Storybook",
    "pydantic": "Pydantic",
    "fastapi": "FastAPI",
    "salesforce": "Salesforce CRM",
    "crm": "Salesforce CRM",
    "agile methodology": "Agile",
    "scrum master": "Scrum",
    "product owner": "Product Management",
}

KNOWN_SKILLS_LOWER = {s.lower(): s for s in KNOWN_SKILLS}
