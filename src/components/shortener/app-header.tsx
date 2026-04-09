import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type AppHeaderProps = {
  onLogoClick?: () => void;
};

const AppHeader = ({ onLogoClick }: AppHeaderProps) => (
  <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
    <div className="container flex h-16 items-center justify-between gap-4 px-4 md:px-8">
      <Link
        href="/"
        className="flex items-center gap-2 group transition-all"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          onLogoClick?.();
        }}
      >
        <div className="group-hover:scale-110 transition-transform overflow-hidden w-10 h-10 flex items-center justify-center">
          <img src="/logo.png" className="w-full h-full object-contain" alt="NovaClipperAI Logo" />
        </div>
        <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          NovaClipperAI
        </span>
      </Link>
      <div className="flex items-center gap-4">
        <ThemeToggle />
      </div>
    </div>
  </header>
);

export default AppHeader;
