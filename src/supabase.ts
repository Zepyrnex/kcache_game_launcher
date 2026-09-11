import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zmapazvbnmkanqiiykfw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptYXBhenZibm1rYW5xaWl5a2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDUzMDMsImV4cCI6MjEwNDY4MTMwM30.lo8iHCHbrBiC6wi4Vl7jkWlzBoM_gHCZCv69HiCX6qI';

export const supabase = createClient(supabaseUrl, supabaseKey);
