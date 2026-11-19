/** People's names for the forecast models, shared by the website and the alerts service. */
export const MODEL_LABELS: Record<string, string> = {
  ukmo_seamless: 'Met Office',
  ukmo_uk_deterministic_2km: 'Met Office UKV',
  ukmo_global_deterministic_10km: 'Met Office Global',
  ecmwf_ifs025: 'ECMWF',
  knmi_harmonie_arome_europe: 'KNMI HARMONIE',
  icon_seamless: 'DWD ICON',
};

export const modelLabel = (id: string) => MODEL_LABELS[id] ?? id;
