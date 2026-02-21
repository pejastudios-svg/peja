"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TestPage() {
  const [result, setResult] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const testLogin = async () => {
    setResult("Testing...");

    try {
      // Test 1: Check if we can reach Supabase
      const { data: sessionData } = await supabase.auth.getSession();
      console.log("Current session:", sessionData);

      // Test 2: Try to sign in
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setResult(`Login Error: ${error.message}`);
        console.error("Error:", error);
        return;
      }

      console.log("Login success:", data);
      setResult(`Success! User: ${data.user?.email}, Session: ${data.session ? "YES" : "NO"}`);

      // Test 3: Check localStorage
      setTimeout(() => {
        const keys = Object.keys(localStorage);
        console.log("LocalStorage keys:", keys);
        setResult(prev => prev + `\n\nLocalStorage keys: ${keys.join(", ") || "EMPTY"}`);
      }, 1000);

    } catch (err) {
      setResult(`Error: ${err}`);
      console.error(err);
    }
  };

  const checkSession = async () => {
    const { data } = await supabase.auth.getSession();
    console.log("Session check:", data);
    setResult(`Session: ${data.session ? "EXISTS" : "NONE"}`);
  };

  return (
    <div className="min-h-screen p-8 bg-dark-950 text-white">
      <h1 className="text-2xl font-bold mb-4">Auth Test Page</h1>

      <div className="space-y-4 max-w-md">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-3 rounded bg-dark-800 border border-dark-600"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-3 rounded bg-dark-800 border border-dark-600"
        />

        <button
          onClick={testLogin}
          className="w-full p-3 bg-primary-600 rounded font-medium"
        >
          Test Login
        </button>

        <button
          onClick={checkSession}
          className="w-full p-3 bg-dark-700 rounded font-medium"
        >
          Check Current Session
        </button>

        <pre className="p-4 bg-dark-800 rounded whitespace-pre-wrap text-sm">
          {result || "Click a button to test"}
        </pre>
      </div>
    </div>
  );
}