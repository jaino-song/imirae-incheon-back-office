"use client"; 
import { useEffect } from "react";

const LoginPage = () => {
  useEffect(() => {
    window.location.href = "http://localhost:3001/auth/kakao";
  }, []);
}

export default LoginPage