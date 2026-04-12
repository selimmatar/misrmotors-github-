-- Add PDF upload field to maintenance_reports table
ALTER TABLE maintenance_reports 
ADD COLUMN IF NOT EXISTS uploaded_pdf_url TEXT;

COMMENT ON COLUMN maintenance_reports.uploaded_pdf_url IS 'URL to the uploaded filled-out work order PDF from shipping team';
