# Register all SQLAlchemy models so Alembic sees them in Base.metadata
from app.models.profiles import Applicant_Profile, Company_Profile, Company_Membership  # noqa: F401
from app.models.resume import Resume  # noqa: F401
from app.models.sessions import Session  # noqa: F401
