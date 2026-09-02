"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, clearToken, getToken, type Role } from "@/lib/api";

export default function Header() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    if (hasToken) {
      api.me().then((user) => setRole(user.role)).catch(() => {
        clearToken();
        setLoggedIn(false);
      });
    }
  }, []);

  return (
    <header className="border-b-4 border-brown bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-2xl font-bold tracking-tight text-ink">
          TODAY <span className="text-blue">Compliant</span>
        </Link>

        <nav className="flex items-center gap-6 font-body text-sm font-medium text-ink">
          <Link href="/" className="hover:text-blue">
            Browse work
          </Link>
          {loggedIn ? (
            <>
              {role === "client" && (
                <>
                  <Link href="/owner-dashboard" className="hover:text-blue">
                    Owner dashboard
                  </Link>
                  <Link href="/post-project" className="hover:text-blue">
                    Post a project
                  </Link>
                </>
              )}
              {role === "contractor" && (
                <Link href="/contractor-dashboard" className="hover:text-blue">
                  Compliance dashboard
                </Link>
              )}
              <button
                onClick={() => {
                  clearToken();
                  setLoggedIn(false);
                  window.location.href = "/";
                }}
                className="rounded border border-brown px-3 py-1.5 text-brown hover:bg-brown hover:text-paper"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-blue">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded bg-blue px-4 py-1.5 font-semibold text-paper hover:bg-blue/90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
