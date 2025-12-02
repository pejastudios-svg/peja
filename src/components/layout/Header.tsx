"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Plus, User, Search } from "lucide-react";
import { Button } from "../ui/Button";

interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
}

export function Header({ onMenuClick, onCreateClick }: HeaderProps) {
  const router = useRouter();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors lg:hidden"
          >
            <Menu className="w-5 h-5 text-dark-200" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">P</span>
            </div>
            <span className="text-xl font-bold text-gradient hidden sm:block">Peja</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/search")}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Search className="w-5 h-5 text-dark-200" />
          </button>

          <Button
            variant="primary"
            size="sm"
            onClick={onCreateClick}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">Report</span>
          </Button>

          <button className="relative p-2 hover:bg-white/5 rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-dark-200" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          <Link
            href="/profile"
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <User className="w-5 h-5 text-dark-200" />
          </Link>
        </div>
      </div>
    </header>
  );
}