import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./EmployeeFormDialog"), "utf8");

describe("mobile EmployeeFormDialog submit lifecycle", () => {
  it("keeps the form busy through the required employee refetch and close", () => {
    expect(source).toContain("const [isSubmitting, setIsSubmitting] = useState(false)");
    expect(source).toContain(
      "const isLoading = isSubmitting || createMutation.isPending || updateMutation.isPending",
    );
    expect(source).toContain("setIsSubmitting(true)");
    expect(source).toContain("await queryClient.refetchQueries");
    expect(source).toContain("finally");
    expect(source).toContain("setIsSubmitting(false)");
  });
});
