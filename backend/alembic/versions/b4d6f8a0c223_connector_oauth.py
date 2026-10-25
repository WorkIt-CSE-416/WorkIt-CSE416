"""connector oauth: the clients, sign-ins and tokens of the MCP connector's sign-in (KAN-377)

Revision ID: b4d6f8a0c223
Revises: a3c5e7f9b112
Create Date: 2026-10-25 13:00:00.000000

New tables, so it is safe to apply before or after the deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b4d6f8a0c223'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b112'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'connector_clients',
        sa.Column('client_id', sa.Text(), nullable=False),
        sa.Column('info', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('client_id'),
    )
    op.execute('ALTER TABLE public.connector_clients ENABLE ROW LEVEL SECURITY')
    op.create_table(
        'connector_requests',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('client_id', sa.Text(), nullable=False),
        sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=True),
        sa.Column('code_hash', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['client_id'], ['connector_clients.client_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code_hash'),
    )
    op.execute('ALTER TABLE public.connector_requests ENABLE ROW LEVEL SECURITY')
    op.create_table(
        'connector_tokens',
        sa.Column('token_hash', sa.Text(), nullable=False),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('grant_id', sa.Uuid(), nullable=False),
        sa.Column('client_id', sa.Text(), nullable=False),
        sa.Column('applicant_id', sa.Uuid(), nullable=False),
        sa.Column('scopes', postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column('resource', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['applicant_id'], ['applicant_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['client_id'], ['connector_clients.client_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('token_hash'),
    )
    op.create_index(op.f('ix_connector_tokens_applicant_id'), 'connector_tokens', ['applicant_id'], unique=False)
    op.create_index(op.f('ix_connector_tokens_grant_id'), 'connector_tokens', ['grant_id'], unique=False)
    op.execute('ALTER TABLE public.connector_tokens ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('connector_tokens')
    op.drop_table('connector_requests')
    op.drop_table('connector_clients')
