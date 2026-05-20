# Error Logging System

A comprehensive error logging and monitoring system for tracking errors, warnings, and info logs throughout the application.

## Features

- **Real-time error capture**: Automatically captures unhandled errors, promise rejections, and application-level errors
- **Categorized logging**: Organize errors by category for easier filtering and analysis
- **Error tracking page**: View all errors at `/error-logs` with filtering and pagination
- **Context preservation**: Capture additional context (user ID, route, custom data) with each error
- **Time-range filtering**: Filter logs by last 24 hours, 7 days, 30 days, or 90 days
- **Severity levels**: Distinguish between errors, warnings, and info messages
- **Automatic cleanup**: Option to delete logs older than 30 days

## Setup

### 1. Apply Database Migration

The migration creates the `error_logs` table with proper indexing and RLS policies:

```bash
supabase migration up
```

Or in your Supabase dashboard:
- Go to SQL Editor
- Run the migration: `supabase/migrations/20260520143000_error_logging_system.sql`

### 2. Initialize Global Error Handling

In your app's root or `__root.tsx`, add:

```typescript
import { setupGlobalErrorHandling, setErrorLogContext } from "@/lib/error-capture.client";

// Setup on app initialization
if (typeof window !== "undefined") {
  setupGlobalErrorHandling();
  setErrorLogContext({ route: window.location.pathname });
}
```

### 3. Set User Context (Optional)

When a user logs in, update the error context:

```typescript
import { setErrorLogContext } from "@/lib/error-capture.client";

setErrorLogContext({
  user_id: user.id,
  user_role: user.role,
  email: user.email,
});
```

## Usage

### Capture Errors Manually

```typescript
import { captureError } from "@/lib/error-capture.client";

try {
  // some operation
} catch (error) {
  await captureError({
    error,
    category: "payment_processing",
    level: "error",
    context: { transaction_id: 123, amount: 5000 },
  });
}
```

### Log Warnings or Info

```typescript
import { captureError } from "@/lib/error-capture.client";

// Log a warning
await captureError({
  error: new Error("Unusual payment pattern detected"),
  category: "fraud_detection",
  level: "warning",
  context: { member_id: "ABC123", flag: "high_frequency" },
});

// Log info
await captureError({
  error: new Error("Loan application submitted"),
  category: "loan_workflow",
  level: "info",
  context: { loan_id: 42, amount: 10000 },
});
```

### In Server Functions

```typescript
import { logErrorToServer } from "@/lib/error-logging.server";

try {
  // server operation
} catch (error) {
  await logErrorToServer({
    level: "error",
    category: "database_sync",
    message: error instanceof Error ? error.message : "Unknown error",
    stack: error instanceof Error ? error.stack : undefined,
    context: { operation: "sync_clients", timestamp: new Date().toISOString() },
  });
}
```

## Viewing Logs

Navigate to `/error-logs` to access the error logs dashboard.

### Features:
- **Filter by level**: error, warning, info
- **Filter by category**: Search for specific error categories
- **Time range**: Last 24h, 7d, 30d, 90d
- **Pagination**: 50 logs per page
- **Details**: Expandable stack traces and context data
- **Cleanup**: Delete logs older than 30 days

## Error Log Entry Schema

```typescript
type ErrorLogEntry = {
  id: string;                              // UUID
  timestamp: string;                       // ISO 8601
  level: "error" | "warning" | "info";    // Severity
  category: string;                        // Error category
  message: string;                         // Error message
  file?: string;                           // Source file
  line?: number;                           // Line number
  stack?: string;                          // Stack trace
  context?: Record<string, unknown>;       // Additional context
  user_id?: string;                        // User ID
  created_at: string;                      // Database timestamp
};
```

## Best Practices

1. **Use consistent categories**: E.g., "loan_calculation", "payment_processing", "authentication"
2. **Include context**: Always add relevant data (IDs, amounts, user info) to help debugging
3. **Don't log sensitive data**: Avoid logging passwords, tokens, or PII
4. **Categorize appropriately**: Use "warning" for degraded performance, "info" for audit trails
5. **Clean up old logs**: Periodically delete old logs to manage database size

## Example Categories

- `loan_calculation` - Loan amount/term calculations
- `payment_processing` - M-Pesa and payment operations
- `database_sync` - Data synchronization errors
- `authentication` - Login/auth failures
- `fraud_detection` - Unusual transaction patterns
- `file_upload` - File handling errors
- `api_integration` - External API failures
- `validation` - Data validation failures
- `uncaughtError` - Global unhandled errors

## Database Queries

### Get recent errors by level
```sql
SELECT * FROM error_logs 
WHERE level = 'error' 
ORDER BY created_at DESC 
LIMIT 50;
```

### Get errors by category for today
```sql
SELECT * FROM error_logs 
WHERE category = 'payment_processing' 
AND created_date = CURRENT_DATE 
ORDER BY created_at DESC;
```

### Count errors per category (last 7 days)
```sql
SELECT category, level, COUNT(*) as count
FROM error_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY category, level
ORDER BY count DESC;
```

### Delete logs older than 30 days
```sql
DELETE FROM error_logs 
WHERE created_at < NOW() - INTERVAL '30 days';
```
