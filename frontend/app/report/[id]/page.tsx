"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EntityGraph from "@/components/EntityGraph";
import GapTable from "@/components/GapTable";
import Checklist from "@/components/Checklist";
import { getReport } from "@/lib/api";

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/history" className="text-sm text-muted-foreground hover:text-primary">
          ← История
        </Link>
        <h1 className="text-xl font-bold">{data.query}</h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs text-muted-foreground">Сущностей</p>
            <p className="text-2xl font-bold">{data.entities_found}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs text-muted-foreground">Разрывов</p>
            <p className="text-2xl font-bold text-red-400">{data.gaps?.length || 0}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs text-muted-foreground">Покрытие</p>
            <p className="text-2xl font-bold">{data.user_entity_coverage || 0}%</p>
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