"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { monthlyClientComparisonData } from "@/mocks/dashboard";

export function ServiceDistributionChart() {
  return (
    <Card data-component="desktop_dashboard_service-chart" className="min-w-0 overflow-hidden opacity-0 animate-fade-in hover-lift" style={{ animationDelay: "250ms" }}>
      <CardHeader data-component="desktop_dashboard_service-chart-header">
        <CardTitle className="text-lg font-semibold">월별 고객 수 비교</CardTitle>
      </CardHeader>
      <CardContent data-component="desktop_dashboard_service-chart-content" className="p-2 sm:p-6">
        <div data-component="desktop_dashboard_service-chart-container" className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={monthlyClientComparisonData} 
              margin={{ left: -10, right: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                tick={{ fontSize: 11 }} 
                tickLine={false} 
                axisLine={false} 
                width={45}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value) => [`${value}명`, ""]}
              />
              <Bar
                dataKey="고객수"
                fill="hsl(var(--chart-1))"
                radius={[4, 4, 0, 0]}
                className="transition-all duration-300"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
