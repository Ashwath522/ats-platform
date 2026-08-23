from dataclasses import asdict, dataclass
from typing import Optional


BRANCHES = [
    {"id": "mechanical", "name": "Mechanical"},
    {"id": "civil", "name": "Civil"},
    {"id": "ece", "name": "Electronics & Communication"},
    {"id": "eee", "name": "Electrical / EEE"},
    {"id": "aerospace", "name": "Aerospace"},
    {"id": "software", "name": "CS / Software"},
]


@dataclass(frozen=True)
class RoleTemplate:
    id: str
    branch: str
    title: str
    description: str


ROLE_TEMPLATES = [
    RoleTemplate("backend-developer", "software", "Backend Developer", "We are looking for a Backend Developer to build reliable APIs and data services using Python, FastAPI, SQL, PostgreSQL, Docker, REST APIs, and cloud platforms such as AWS or GCP. The role involves designing database models, integrating queues or caches such as Redis, writing tests, improving CI/CD pipelines, and collaborating with frontend and product teams. Candidates should show experience with production debugging, performance tuning, authentication, and clean service boundaries."),
    RoleTemplate("frontend-developer", "software", "Frontend Developer", "We are hiring a Frontend Developer to build responsive product interfaces using React, TypeScript, JavaScript, HTML, CSS, Redux, REST APIs, and modern build tooling such as Vite or Webpack. The engineer will translate Figma designs into accessible UI, manage component state, handle API integration, and improve performance across desktop and mobile browsers. Strong candidates can explain tradeoffs, write maintainable components, and collaborate closely with designers and backend engineers."),
    RoleTemplate("full-stack-developer", "software", "Full Stack Developer", "We need a Full Stack Developer comfortable across React, TypeScript, Python, FastAPI, SQL, PostgreSQL, Docker, REST APIs, and CI/CD. This role owns features from database schema and API design through frontend implementation, error handling, deployment, and monitoring. Candidates should demonstrate practical product judgment, secure authentication patterns, testing discipline, and the ability to debug issues across the stack."),
    RoleTemplate("data-scientist", "software", "Data Scientist", "We are seeking a Data Scientist with hands-on experience in Python, SQL, Machine Learning, Statistical Modeling, Forecasting, Feature Engineering, Scikit-Learn, TensorFlow or PyTorch, and data pipelines. The role includes cleaning data, building experiments, communicating model performance, and partnering with business teams to turn ambiguous questions into measurable insights. Experience with Time Series, NLP, dashboards, and production handoff to engineering teams is a plus."),
    RoleTemplate("devops-engineer", "software", "DevOps Engineer", "We are hiring a DevOps Engineer to improve deployment reliability using Docker, Kubernetes, Terraform, CI/CD, AWS, Azure or GCP, Linux operations, monitoring, and secure release automation. The role includes containerizing services, maintaining infrastructure as code, managing secrets, improving build pipelines, and troubleshooting production incidents. Strong candidates bring practical experience with networking basics, observability, rollback strategies, and collaborative support for engineering teams."),
    RoleTemplate("product-manager", "software", "Product Manager", "We are looking for a Product Manager who can work with engineering, design, sales, and customers to define roadmap priorities and ship measurable product improvements. The role requires Agile delivery, stakeholder communication, analytics, market research, user interviews, clear requirements, and strong project management. Candidates should show evidence of prioritization, product judgment, launch planning, and the ability to translate user problems into crisp execution plans."),
    RoleTemplate("mechanical-design-engineer", "mechanical", "Mechanical Design Engineer", "We are looking for a Mechanical Design Engineer to develop components and assemblies using SolidWorks, AutoCAD, CATIA, GD&T, tolerance analysis, materials science, and mechanical design principles. The role includes creating 3D models, engineering drawings, BOMs, DFM/DFA reviews, and design validation through ANSYS or FEA (Finite Element Analysis). Candidates should understand manufacturing processes, sheet metal design, injection molding, root cause analysis, and product lifecycle management from concept through release."),
    RoleTemplate("manufacturing-production-engineer", "mechanical", "Manufacturing / Production Engineer", "We are hiring a Manufacturing or Production Engineer to improve shop-floor processes using CNC Machining, Lean Manufacturing, Six Sigma, manufacturing processes, welding, CAD/CAM, root cause analysis, and quality control methods. The engineer will analyze cycle time, reduce defects, support tooling and fixtures, coordinate with production teams, and implement continuous improvement projects. Experience with mechanical drawings, GD&T, materials selection, additive manufacturing, and production documentation is valuable."),
    RoleTemplate("civil-site-structural-engineer", "civil", "Civil Site Engineer / Structural Engineer", "We are seeking a Civil Site or Structural Engineer with experience in AutoCAD Civil 3D, STAAD Pro, ETABS, structural analysis, structural design, concrete design, steel design, surveying, and site supervision. The role involves coordinating construction activities, preparing quantity estimates, checking drawings, applying building codes, and tracking work quality and safety on site. Candidates should understand geotechnical engineering, reinforced concrete design, project estimation, MS Project or Primavera P6, and contractor coordination."),
    RoleTemplate("electronics-design-engineer", "ece", "Electronics Design Engineer", "We are looking for an Electronics Design Engineer to design and validate circuits using PCB Design, Altium Designer, analog circuit design, digital circuit design, VLSI concepts, circuit simulation (SPICE), oscilloscopes, and multimeters. The role includes schematic capture, PCB layout review, component selection, bring-up testing, signal integrity checks, and documentation for manufacturable electronics. Experience with communication protocols such as I2C, SPI, UART, CAN, RF Design, and MATLAB/Simulink is preferred."),
    RoleTemplate("embedded-systems-engineer", "ece", "Embedded Systems Engineer", "We are hiring an Embedded Systems Engineer to build firmware for microcontrollers, ARM Cortex platforms, Embedded C, communication protocols, IoT devices, sensors, and real-time hardware interfaces. The role includes board bring-up, driver development, debugging with oscilloscopes or logic analyzers, integrating SPI/I2C/UART/CAN, and validating performance against product requirements. Strong candidates can connect firmware decisions to PCB constraints, power consumption, reliability, and production testing."),
    RoleTemplate("electrical-power-systems-engineer", "eee", "Electrical Engineer / Power Systems Engineer", "We need an Electrical or Power Systems Engineer with practical knowledge of power systems, power electronics, transformers, switchgear, motors and drives, PLC programming, SCADA, and electrical safety standards. The role includes load flow analysis, relay coordination, power system protection, electrical circuit design, and commissioning support for industrial or utility projects. Experience with AutoCAD Electrical, renewable energy systems, solar PV design, instrumentation, VFDs, and SCADA/HMI systems is highly relevant."),
    RoleTemplate("aerospace-design-engineer", "aerospace", "Aerospace Design Engineer", "We are seeking an Aerospace Design Engineer to support aircraft or spacecraft systems using aerodynamics, flight mechanics, propulsion systems, aircraft structures, composite materials, CATIA, MATLAB/Simulink, and systems engineering. The role includes aerodynamic design, structural analysis, design reviews, simulation, test planning, and documentation for airworthiness or mission requirements. Experience with avionics, gas turbine engines, flight testing, orbital mechanics, satellite systems, or rocket propulsion is a strong advantage."),
]


def list_branches():
    return BRANCHES


def list_roles(branch: Optional[str] = None):
    roles = ROLE_TEMPLATES
    if branch:
        roles = [role for role in roles if role.branch == branch]
    return [asdict(role) for role in roles]


def get_role(role_id: str) -> Optional[RoleTemplate]:
    return next((role for role in ROLE_TEMPLATES if role.id == role_id), None)
