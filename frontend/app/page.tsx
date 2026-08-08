"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import QueryForm from "@/components/QueryForm";
import EntityGraph from "@/components/EntityGraph";
import GapTable from "@/components/GapTable";
import Checklist from "@/components/Checklist";
import ReportSkeleton from "@/components/ReportSkeleton";
import { analyzeQuery } from "@/lib/api";

interface Report {
  id: string;
  query: string;
  entities_found: number;
  user_entity_coverage: number;
  top3_entity_coverage: number;
  gaps: any[];
  checklist: string[];
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  // Entities collected from extractor for graph
  const [allEntities, setAllEntities] = useState<any[]>([]);

  const handleAnalyze = async (query: string, url?: string, engine?: string) => {
    setLoading(true);
    setError("");
    setReport(null);
    setAllEntities([]);

    try {
      const data = await analyzeQuery(query, url, engine);
      setReport(data);

      // Fetch full report for entities
      const full = await fetch(
        `http://localhost:8000/api/history/${data.id}`
      ).then((r) => r.json());

      if (full?.result_json?.gaps) {
        // Collect entities from gaps for graph
        const entities = full.result_json.gaps.map((g: any) => ({
          name: g.entity,
          type: g.entity_type || "Concept",
          confidence: g.priority === "critical" ? 1.0 : g.priority === "high" ? 0.8 : 0.5,
          source_url: "",
        }));
        setAllEntities(entities);
      }
    } catch (err: any) {
      setError(err.message || "Ошибка анализа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SERP-рентген — конкурентный анализ</CardTitle>
          <p className="text-sm text-muted-foreground">
            Введите поисковый запрос, чтобы увидеть какие сущности есть в топ-20
            выдачи и какие отсутствуют на вашей странице
          </p>
        </CardHeader>
        <CardContent>
          <QueryForm onAnalyze={handleAnalyze} loading={loading} />
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/50 bg-red-950/20">
          <CardContent className="p-4 text-red-400">{error}</CardContent>
        </Card>
      )}

      {loading && <ReportSkeleton />}

      {report && !loading && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">📊 Обзор</TabsTrigger>
            <TabsTrigger value="graph">🕸 Граф сущностей</TabsTrigger>
            <TabsTrigger value="gaps">🕳 Разрывы ({report.gaps.length})</TabsTrigger>
            <TabsTrigger value="checklist">✅ Чек-лист ({report.checklist.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Сущностей найдено</p>
                  <p className="text-3xl font-bold">{report.entities_found}</p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Разрывов</p>
                  <p className="text-3xl font-bold text-red-400">{report.gaps.length}</p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Покрытие топ-3</p>
                  <p className="text-3xl font-bold">{report.top3_entity_coverage}%</p>
                </CardHeader>
              </Card>
            </div>

            {report.user_entity_coverage > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Покрытие вашей страницы</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{ width: `${report.user_entity_coverage}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {report.user_entity_coverage}% сущностей из топа покрыто на вашей странице
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="graph">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Граф сущностей</CardTitle>
              </CardHeader>
              <CardContent>
                <EntityGraph entities={allEntities} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gaps">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Разрывы ({report.gaps.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GapTable gaps={report.gaps} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checklist">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Чек-лист действий</CardTitle>
              </CardHeader>
              <CardContent>
                <Checklist items={report.checklist} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}