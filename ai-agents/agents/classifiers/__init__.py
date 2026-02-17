"""
CLIF Log-Type Classifiers
==========================
Rule-based and heuristic classifiers for log types beyond NSL-KDD network data.

Each classifier outputs a standardised dict compatible with TriageData:
  - is_attack: bool
  - confidence: float (0-1)
  - category: str
  - severity: str
  - mitre_tactic: str
  - mitre_technique: str
  - explanation: str
"""

from .log_detector import detect_log_type, LogType
from .sysmon import SysmonClassifier
from .windows_security import WindowsSecurityClassifier
from .auth import AuthLogClassifier
from .firewall import FirewallLogClassifier
from .generic import GenericLogClassifier

__all__ = [
    "detect_log_type",
    "LogType",
    "SysmonClassifier",
    "WindowsSecurityClassifier",
    "AuthLogClassifier",
    "FirewallLogClassifier",
    "GenericLogClassifier",
]
