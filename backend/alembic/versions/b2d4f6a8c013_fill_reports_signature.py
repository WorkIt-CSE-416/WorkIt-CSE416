"""fill_reports.signature: a report's group, job system + field kind + error (KAN-478)

Revision ID: b2d4f6a8c013
Revises: bafdca0d9501
Create Date: 2026-10-31 17:20:00.000000

Adds the column nullable, fills it for the reports already stored (the
rule of app/schemas/fill_reports.py's signature_of, copied here so this
migration never changes with it), then makes it NOT NULL and indexes it.
Apply it before the deploy: the new code writes and reads the column, and
old code ignores it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2d4f6a8c013'
down_revision: Union[str, Sequence[str], None] = 'bafdca0d9501'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _signature(job_system: str, fields: list | None) -> str:
    fields = fields or []
    field = next((f for f in fields if f.get('error')), None) or next((f for f in fields if f.get('marked')), None)
    if field is None:
        return f'{job_system}::'
    return f"{job_system}:{field['kind']}:{field.get('error') or 'Marked'}"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('fill_reports', sa.Column('signature', sa.String(length=80), nullable=True))
    bind = op.get_bind()
    for id_, job_system, fields in bind.execute(sa.text('SELECT id, job_system, fields FROM fill_reports')).all():
        bind.execute(sa.text('UPDATE fill_reports SET signature = :s WHERE id = :id'), {'s': _signature(job_system, fields), 'id': id_})
    op.alter_column('fill_reports', 'signature', nullable=False)
    op.create_index('ix_fill_reports_signature', 'fill_reports', ['signature'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_fill_reports_signature', table_name='fill_reports')
    op.drop_column('fill_reports', 'signature')
