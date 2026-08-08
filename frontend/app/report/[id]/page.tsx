"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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
    getReport(id).then(setReport).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!report) return <div className="p-8 text-center text-red-400">Report not found</div>;

  const data = report.result_json;

  const handleDownload = async (format: "md" | "pdf") => {
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
    else await downloadPDF(reportData);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/history" className="text-sm text-muted-foreground hover:text-primary">← History</Link>
          <h1 className="text-xl font-bold truncate max-w-lg">{data.query}</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={async () => handleDownload("md")}> Download MD</Button>
          <Button size="sm" variant="outline" onClick={async () => handleDownload("pdf")}> Download PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Entities</p><p className="text-xl font-bold">{data.entities_found}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Gaps</p><p className="text-xl font-bold text-red-400">{data.gaps?.length || 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Top-3 coverage</p><p className="text-xl font-bold">{data.top3_entity_coverage || 0}%</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Your page</p><p className="text-xl font-bold">{data.user_entity_coverage || 0}%</p></CardContent></Card>
      </div>

      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps"> Gaps</TabsTrigger>
          <TabsTrigger value="checklist"> Checklist</TabsTrigger>
        </TabsList>
        <TabsContent value="gaps"><Card><CardContent className="pt-4"><GapTable gaps={data.gaps || []} /></CardContent></Card></TabsContent>
        <TabsContent value="checklist"><Card><CardContent className="pt-4"><Checklist items={data.checklist || []} /></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}