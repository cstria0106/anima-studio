import { StudioShell } from "@/components/studio-shell";
import { UiPreferencesProvider } from "@/components/ui-preferences-provider";

export default function Home() {
  return (
    <UiPreferencesProvider>
      <StudioShell />
    </UiPreferencesProvider>
  );
}
