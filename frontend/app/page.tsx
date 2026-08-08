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
  const [allEntities, setAllEntities] = useState<any[]>([]);

  const handleAnalyze = async (query: string, url?: string, engine?: string) => {
    setLoading(true);
    setError("");
    setReport(null);
    setAllEntities([]);

    try {
      const data = await analyzeQuery(query, url, engine);
      setReport(data);

      const full = await fetch(
        `http://localhost:8000/api/history/${data.id}`
      ).then((r) => r.json());

      if (full?.result_json?.gaps) {
        const entities = full.result_json.gaps.map((g: any) => ({
          name: g.entity,
          type: g.entity_type || "Concept",
          confidence: g.priority === "critical" ? 1.0 : g.priority === "high" ? 0.8 : 0.5,
          source_url: "",
        }));
        setAllEntities(entities);
      }
    } catch (err: any) {
      setError(err.message || "Analysis error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SERP X-Ray  competitive analysis</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter a search query to see which entities appear in the top-20
            results and which are missing from your page
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
            <TabsTrigger value="overview"> Overview</TabsTrigger>
            <TabsTrigger value="graph"> Entity Graph</TabsTrigger>
            <TabsTrigger value="gaps"> Gaps ({report.gaps.length})</TabsTrigger>
            <TabsTrigger value="checklist"> Checklist ({report.checklist.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Entities found</p>
                  <p className="text-3xl font-bold">{report.entities_found}</p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Gaps</p>
                  <p className="text-3xl font-bold text-red-400">{report.gaps.length}</p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <p className="text-xs text-muted-foreground">Top-3 coverage</p>
                  <p className="text-3xl font-bold">{report.top3_entity_coverage}%</p>
                </CardHeader>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="graph">
            <Card>
              <CardHeader><CardTitle className="text-sm">Entity Graph</CardTitle></CardHeader>
              <CardContent><EntityGraph entities={allEntities} /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gaps">
            <Card>
              <CardHeader><CardTitle className="text-sm">Gaps ({report.gaps.length})</CardTitle></CardHeader>
              <CardContent><GapTable gaps={report.gaps} /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checklist">
            <Card>
              <CardHeader><CardTitle className="text-sm">Action Checklist</CardTitle></CardHeader>
              <CardContent><Checklist items={report.checklist} /></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}