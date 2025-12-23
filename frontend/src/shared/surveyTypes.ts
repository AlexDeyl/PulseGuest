export type FieldType =
  | "text"
  | "textarea"
  | "rating_1_10"
  | "single_select"
  | "multi_select"
  | "date"
  | "range";

export type Option = { value: string; label: string };

export type SurveyField = {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: Option[];
  min?: number;
  max?: number;
};

export type SurveySchema = {
  id: string;
  title: string;
  description?: string;
  fields: SurveyField[];
};
