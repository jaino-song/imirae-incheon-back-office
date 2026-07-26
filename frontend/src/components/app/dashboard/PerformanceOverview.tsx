import { Progress } from "@/components/ui/progress";
import { ContentPaper } from "../root/content-paper";

export interface PerformanceMetric {
  label: string;
  conversion: number;
  progress: number;
}

interface PerformanceOverviewProps {
  metrics: PerformanceMetric[];
  title: string;
  subtitle: string;
}

export const PerformanceOverview = ({ metrics, title, subtitle }: PerformanceOverviewProps) => {
  return (
    <ContentPaper data-component="desktop_dashboard_performance" className="flex-[2] p-5 sm:p-6" disableAnimation>
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      <div data-component="desktop_dashboard_performance-metrics" className="flex flex-col gap-5 mt-6">
        {metrics.map((metric) => (
          <div data-component="desktop_dashboard_performance-metric" key={metric.label}>
            <div className="flex flex-row justify-between mb-1">
              <p className="text-sm font-semibold">{metric.label}</p>
              <p className="text-sm text-muted-foreground">{metric.conversion}%</p>
            </div>
            <Progress value={metric.progress} className="h-2.5" />
          </div>
        ))}
      </div>
    </ContentPaper>
  );
};
