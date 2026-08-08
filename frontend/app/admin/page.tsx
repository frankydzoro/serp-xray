"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AdminPrompts from "@/components/AdminPrompts";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">⚙️ Админ-панель</h1>
      <Card>
        <CardHeader>
          <CardTitle>Модель и промпты</CardTitle>
          <p className="text-sm text-muted-foreground">
            Изменения применяются к следующему запросу без перезапуска
          </p>
        </CardHeader>
        <CardContent>
          <AdminPrompts />
        </CardContent>
      </Card>
    </div>
  );
}