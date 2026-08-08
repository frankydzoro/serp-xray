from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import analyzer, admin, history
from db import init_db


app = FastAPI(
    title="SERP-рентген",
    description="Локальный инструмент конкурентного анализа поисковой выдачи через OpenRouter + SerpAPI",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyzer.router)
app.include_router(admin.router)
app.include_router(history.router)


@app.on_event("startup")
async def startup():
    init_db()


@app.get("/")
async def root():
    return {"service": "SERP-рентген", "version": "0.1.0", "docs": "/docs"}