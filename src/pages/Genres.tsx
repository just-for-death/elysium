import { memo } from "react";
import { useTranslation } from "react-i18next";

import { GenreList } from "../components/Genre";
import { PageHeader } from "../components/PageHeader";

export const GenresPage = memo(() => {
  const { t } = useTranslation();

  return (
    <div>
      <PageHeader title={t("genre.title")} />
      <GenreList />
    </div>
  );
});
