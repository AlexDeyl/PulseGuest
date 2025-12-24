import AppShell from "../components/AppShell";
import SurveyWizard from "../components/SurveyWizard";
import GlassCard from "../components/GlassCard";
import { demoSurvey } from "../shared/demoSurvey";

export default function PublicSurveyPage() {
  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-4">
          <GlassCard>
            <div className="text-sm text-[color:var(--pg-muted)]">PulseGuest</div>
            <h1 className="mt-1 text-3xl font-semibold text-[color:var(--pg-text)]">
              Оставьте отзыв за 30 секунд
            </h1>
            <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
              Небольшая анкета помогает улучшать сервис. Спасибо, что делитесь
              впечатлением.
            </p>
          </GlassCard>

          <SurveyWizard
            schema={demoSurvey}
            onSubmit={async (answers) => {
              console.log("submit answers:", answers);
            }}
          />
        </section>

        <aside className="space-y-4">
          <GlassCard>
            <h3 className="text-sm font-semibold text-[color:var(--pg-text)]">
              Почему это удобно
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-[color:var(--pg-muted)]">
              <li>• Слайды + микроанимации</li>
              <li>• Подсказки прямо в форме</li>
              <li>• Одинаково красиво на мобилке</li>
            </ul>
          </GlassCard>

          <GlassCard>
            <h3 className="text-sm font-semibold text-[color:var(--pg-text)]">
              Дальше
            </h3>
            <p className="mt-2 text-sm text-[color:var(--pg-muted)]">
              Подключим API схемы анкеты и сохранение ответов. Затем — админка со
              статистикой и ролями.
            </p>
          </GlassCard>
        </aside>
      </div>
    </AppShell>
  );
}
