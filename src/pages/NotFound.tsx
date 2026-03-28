import { Link } from "react-router-dom";
import { Home } from "lucide-react";

const NotFound = () => (
  <div className="min-h-[60vh] flex items-center justify-center p-8">
    <div className="text-center">
      <h1 className="text-6xl font-bold text-primary/20 mb-4">404</h1>
      <h2 className="text-lg font-semibold text-foreground mb-2">Sidan hittades inte</h2>
      <p className="text-sm text-muted-foreground mb-6">Sidan du letar efter finns inte eller har flyttats.</p>
      <Link to="/"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
        <Home className="w-4 h-4" />
        Till Dashboard
      </Link>
    </div>
  </div>
);

export default NotFound;
