import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteOldErrorLogs, listErrorLogs } from "@/lib/error-logging.functions";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/error-logs")({
  component: ErrorLogsPage,
});

function ErrorLogsPage() {
  const [page, setPage] = useState(0);
  const [level, setLevel] = useState<"error" | "warning" | "info" | "">();
  const [category, setCategory] = useState("");
  const [daysFilter, setDaysFilter] = useState("7");

  const limit = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["error-logs", page, level, category, daysFilter],
    queryFn: () =>
      listErrorLogs({
        limit,
        offset: page * limit,
        level: level ? (level as "error" | "warning" | "info") : undefined,
        category: category || undefined,
        days: parseInt(daysFilter),
      }),
  });

  const handleClearOld = async () => {
    if (
      window.confirm("Delete error logs older than 30 days? This cannot be undone.")
    ) {
      await deleteOldErrorLogs({ daysOld: 30 });
      refetch();
    }
  };

  const handleReset = () => {
    setPage(0);
    setLevel(undefined);
    setCategory("");
    setDaysFilter("7");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Error Logs</h1>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Level
              </label>
              <Select
                value={level || ""}
                onValueChange={(v) => setLevel(v as "error" | "warning" | "info" | "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All levels</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <Input
                placeholder="Filter by category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time Range
              </label>
              <Select value={daysFilter} onValueChange={setDaysFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 24 hours</SelectItem>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-2">
              <Button
                onClick={handleReset}
                variant="outline"
                className="flex-1"
              >
                Reset
              </Button>
              <Button
                onClick={handleClearOld}
                variant="destructive"
                className="flex-1"
              >
                Clear Old
              </Button>
            </div>
          </div>

          {data && (
            <p className="text-sm text-gray-600">
              Showing {page * limit + 1} to{" "}
              {Math.min((page + 1) * limit, data.total)} of {data.total} errors
            </p>
          )}
        </div>

        {/* Error Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {!data?.readable ? (
            <div className="p-8 text-center text-red-600">
              <p className="font-semibold mb-2">Unable to load error logs</p>
              <p className="text-sm">{data?.reason}</p>
            </div>
          ) : data?.items?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No errors found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Timestamp</TableHead>
                      <TableHead className="w-20">Level</TableHead>
                      <TableHead className="w-32">Category</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="w-24">File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((log) => (
                      <TableRow key={log.id} className="hover:bg-gray-50">
                        <TableCell className="text-xs text-gray-600">
                          <div>{new Date(log.created_at).toLocaleString()}</div>
                          <div className="text-gray-400">
                            {formatDistanceToNow(new Date(log.created_at), {
                              addSuffix: true,
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              log.level === "error"
                                ? "bg-red-100 text-red-800"
                                : log.level === "warning"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {log.level.toUpperCase()}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-gray-700">
                          {log.category}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-mono truncate">{log.message}</div>
                          {log.stack && (
                            <details className="mt-2 cursor-pointer">
                              <summary className="text-xs text-blue-600 hover:underline">
                                Stack trace
                              </summary>
                              <pre className="text-xs bg-gray-100 p-2 mt-2 rounded overflow-auto max-h-40">
                                {log.stack}
                              </pre>
                            </details>
                          )}
                          {log.context && (
                            <details className="mt-2 cursor-pointer">
                              <summary className="text-xs text-blue-600 hover:underline">
                                Context
                              </summary>
                              <pre className="text-xs bg-gray-100 p-2 mt-2 rounded overflow-auto max-h-40">
                                {JSON.stringify(log.context, null, 2)}
                              </pre>
                            </details>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {log.file && (
                            <>
                              <div className="truncate">{log.file}</div>
                              {log.line && <div>:{log.line}</div>}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="text-sm text-gray-600">
                  Page {page + 1} of{" "}
                  {Math.ceil((data?.total ?? 0) / limit)}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0 || isLoading}
                    variant="outline"
                  >
                    Previous
                  </Button>
                  <Button
                    onClick={() => setPage(page + 1)}
                    disabled={
                      (page + 1) * limit >= (data?.total ?? 0) || isLoading
                    }
                    variant="outline"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
