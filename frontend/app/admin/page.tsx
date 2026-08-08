"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AdminPrompts from "@/components/AdminPrompts";

export default function AdminPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure model and prompts. Changes apply immediately.
        </p>
      </div>

      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <CardTitle className="text-base font-semibold">
              Model & Prompts
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Changes take effect on the next query without restart.
          </p>
        </CardHeader>
        <CardContent>
          <AdminPrompts />
        </CardContent>
      </Card>
    </div>
  );
}