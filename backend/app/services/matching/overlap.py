'''
How much of each piece of text a job posting talks about: Postgres's
`ts_rank` over the posting's stemmed `fts` column, with the text's words as
an OR query, so a bullet scores by how many of its words the posting uses and
how often. Zero means none. Tailoring ranks bullets and skills with it
(KAN-176), and it is the skill-overlap score the matching design calls for
(CLAUDE.md here), so both read one query.
'''
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# plainto_tsquery ANDs every word; "|" makes any one of them count. NULLIF:
# text of stopwords only makes an empty query, which ts_rank can't take.
_RANK = text("""
    SELECT coalesce(ts_rank(
        j.fts,
        NULLIF(replace(plainto_tsquery('english', t.body)::text, ' & ', ' | '), '')::tsquery
    ), 0)
    FROM job_postings j,
         unnest(CAST(:texts AS text[])) WITH ORDINALITY AS t(body, ord)
    WHERE j.id = :job_id
    ORDER BY t.ord
""")


async def rank_against_job(db: AsyncSession, job_id: uuid.UUID, texts: list[str]) -> list[float]:
    '''One score per text, in order; all zero when the job is gone.'''
    if not texts:
        return []
    scores = (await db.execute(_RANK, {"texts": texts, "job_id": job_id})).scalars().all()
    return list(scores) if scores else [0.0] * len(texts)
