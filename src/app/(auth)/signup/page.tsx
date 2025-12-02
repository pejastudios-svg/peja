const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");
  setLoading(true);

  if (!formData.fullName || !formData.email || !formData.phone || !formData.password) {
    setError("Please fill in all fields");
    setLoading(false);
    return;
  }

  if (formData.password !== formData.confirmPassword) {
    setError("Passwords do not match");
    setLoading(false);
    return;
  }

  if (formData.password.length < 6) {
    setError("Password must be at least 6 characters");
    setLoading(false);
    return;
  }

  try {
    // Sign up the user
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (authData.user) {
      // Create the user profile in public.users table
      const { error: profileError } = await supabase.from("users").insert({
        id: authData.user.id,
        email: formData.email,
        phone: formData.phone,
        full_name: formData.fullName,
        email_verified: false,
        phone_verified: false,
        status: "active",
        reputation_score: 0,
        is_guardian: false,
      });

      if (profileError) {
        console.error("Profile creation error:", profileError);
        // Don't block signup if profile creation fails
      }
    }

    router.push("/onboarding");
  } catch (err) {
    console.error("Signup error:", err);
    setError("An unexpected error occurred");
    setLoading(false);
  }
};