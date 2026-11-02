class BaseAnalyser:
    def analyse(self, project, files, evidence):
        return [], []

from .analysers.electronics import ElectronicsAnalyser
class MechanicalAnalyser(BaseAnalyser): pass
class CivilAnalyser(BaseAnalyser): pass
class SoftwareAnalyser(BaseAnalyser): pass
class AiMlAnalyser(BaseAnalyser): pass
class RoboticsIotAnalyser(BaseAnalyser): pass
class OtherAnalyser(BaseAnalyser): pass

REGISTRY = {"electronics": ElectronicsAnalyser, "mechanical": MechanicalAnalyser, "civil": CivilAnalyser, "software": SoftwareAnalyser, "ai_ml": AiMlAnalyser, "robotics_iot": RoboticsIotAnalyser, "other": OtherAnalyser}
