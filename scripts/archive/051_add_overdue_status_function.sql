-- Add function to automatically update overdue status for payment schedules
-- Run this migration to enable automatic overdue detection

-- Function to update overdue schedules
CREATE OR REPLACE FUNCTION update_overdue_schedules()
RETURNS void AS $$
BEGIN
  -- Update payment_schedules where due_date has passed and not fully paid
  UPDATE payment_schedules
  SET status = 'overdue'
  WHERE due_date < CURRENT_DATE
    AND status IN ('pending', 'partial')
    AND (paid_amount IS NULL OR paid_amount < amount);
    
  -- Update accounts_receivable where due_date has passed and not fully paid
  UPDATE accounts_receivable
  SET status = 'overdue'
  WHERE due_date < CURRENT_DATE
    AND status IN ('pending', 'partially_paid')
    AND collected_amount < amount;
    
  -- Update accounts_payable where due_date has passed and not fully paid
  UPDATE accounts_payable
  SET status = 'overdue'
  WHERE due_date < CURRENT_DATE
    AND status IN ('pending', 'partial')
    AND paid_amount < amount;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run daily (requires pg_cron extension)
-- If pg_cron is not available, call this function from your application daily
-- SELECT cron.schedule('update-overdue-daily', '0 1 * * *', 'SELECT update_overdue_schedules()');

-- For immediate testing, run:
-- SELECT update_overdue_schedules();
