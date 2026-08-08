"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GapTable from "@/components/GapTable";
import Checklist from "@/components/Checklist";
import { getReport } from "@/lib/api";
import { downloadMarkdown, downloadPDF } from "@/lib/export";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReport(id)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center">Загрузка...</div>;
  if (!report) return <div className="p-8 text-center text-red-400">Отчёт не найден</div>;

  const data = report.result_json;

  const handleDownload = (format: "md" | "pdf") => {
    const reportData = {
      id,
      query: data.query,
      entities_found: data.entities_found,
      user_entity_coverage: data.user_entity_coverage || 0,
      top3_entity_coverage: data.top3_entity_coverage || 0,
      gaps: data.gaps || [],
      checklist: data.checklist || [],
      timestamp: report.created_at,
    };

    if (format === "md") downloadMarkdown(reportData);
    else downloadPDF(reportData);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/history" className="text-sm text-muted-foreground hover:text-primary">
            ← История
          </Link>
          <h1 className="text-xl font-bold truncate max-w-lg">{data.query}</h1>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleDownload("md")}>
            📄 Скачать MD
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleDownload("pdf")}>
            📕 Скачать PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardHeader className="p-3 pb-1">
            <p className="text-xs text-muted-foreground">Сущностей</p>
            <p className="text-xl font-bold">{data.entities_found}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <p className="text-xs text-muted-foreground">Разрывов</p>
            <p className="text-xl font-bold text-red-400">{data.gaps?.length || 0}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <p className="text-xs text-muted-foreground">Покрытие топ-3</p>
            <p className="text-xl font-bold">{data.top3_entity_coverage || 0}%</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <p className="text-xs text-muted-foreground">Покрытие страницы</p>
            <p className="text-xl font-bold">{data.user_entity_coverage || 0}%</p>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">🕳 Разрывы</TabsTrigger>
          <TabsTrigger value="checklist">✅ Чек-лист</TabsTrigger>
        </TabsList>
        <TabsContent value="gaps">
          <Card>
            <CardContent className="pt-4">
              <GapTable gaps={data.gaps || []} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="checklist">
          <Card>
            <CardContent className="pt-4">
              <Checklist items={data.checklist || []} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}