"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AdminPrompts from "@/components/AdminPrompts";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">️ Admin Panel</h1>
      <Card>
        <CardHeader>
          <CardTitle>Model & Prompts</CardTitle>
          <p className="text-sm text-muted-foreground">
            Changes take effect on the next query without restart
          </p>
        </CardHeader>
        <CardContent>
          <AdminPrompts />
        </CardContent>
      </Card>
    </div>
  );
}