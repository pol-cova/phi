class Phi < Formula
  desc "Fetch, test, and submit coding problems from your terminal"
  homepage "https://github.com/pol-cova/phi"
  license "MIT"
  head "https://github.com/pol-cova/phi.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir[libexec/"bin/*"]
  end

  def caveats
    <<~EOS
      Install the browser once:
        phi setup
    EOS
  end

  test do
    assert_match "phi", shell_output("#{bin}/phi --help")
  end
end
