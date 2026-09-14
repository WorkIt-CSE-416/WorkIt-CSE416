'''
FastAPI entry file 
'''

from fastapi import FastAPI

app = FastAPI(
    title="WorkIt API",
    version="0.1.0",
    summary="Backend for the WorkIt job board.",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
