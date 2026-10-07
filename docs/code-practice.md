You are working in a production application with this stack:

Backend:
- Go
- chi router
- gorilla/websocket
- PostgreSQL
- PostGIS
- pgx
- sqlc
- Redis
- FCM push notifications

Frontend:
- React Native
- Expo
- TypeScript
- MapLibre

Infrastructure:
- Self-hosted map tiles
- Fly.io deployment

Your highest priority is NOT just making the code work.

The code must be:

- human-readable
- explicit
- idiomatic
- easy to debug
- easy to review
- easy to maintain
- easy to understand by reading from top to bottom

Avoid writing code that is technically clever but difficult for a human developer to follow.

I want boring, obvious, production-quality code.

A developer should be able to open a file and understand the execution flow without mentally decoding abstractions, jumping through many tiny helper functions, or understanding obscure language tricks.

---

# 1. READABILITY OVER CLEVERNESS

Always prefer readable code over clever or compressed code.

Do NOT optimize for:
- fewer lines
- fewer characters
- impressive abstractions
- generic architectures
- clever language features
- theoretical extensibility

Optimize for:
- clarity
- explicit flow
- maintainability
- predictable behavior
- ease of debugging

If two implementations work equally well, choose the one that requires less mental effort to understand.

---

# 2. DO NOT CREATE UNNECESSARY FUNCTIONS

Do NOT extract functions merely because a block contains several lines.

Before creating a function, ask:

- Is this logic reused?
- Does the function represent a meaningful domain operation?
- Does giving it a name substantially improve readability?
- Does it isolate genuinely complex logic?
- Does it make testing meaningfully easier?
- Is it independently meaningful?

If not, keep the code inline.

Avoid creating tiny functions that:
- are called only once
- contain 1–3 trivial statements
- simply wrap another call
- rename something already obvious
- exist only to make the parent function shorter
- make me jump around the file to understand the execution flow

Bad:

```go
func (s *Service) CreateUser(ctx context.Context, req CreateUserRequest) error {
    user := s.buildUser(req)

    if err := s.saveUser(ctx, user); err != nil {
        return err
    }

    return nil
}

func (s *Service) buildUser(req CreateUserRequest) User {
    return User{
        Name:  req.Name,
        Email: req.Email,
    }
}

func (s *Service) saveUser(ctx context.Context, user User) error {
    return s.queries.CreateUser(ctx, db.CreateUserParams{
        Name:  user.Name,
        Email: user.Email,
    })
}
```

Prefer:

```go
func (s *Service) CreateUser(ctx context.Context, req CreateUserRequest) error {
    return s.queries.CreateUser(ctx, db.CreateUserParams{
        Name:  req.Name,
        Email: req.Email,
    })
}
```

Do not blindly follow the rule that "small functions are always better."

A cohesive 20-line function can be much easier to understand than a 5-line function that calls six private helpers.

---

# 3. KEEP THE MAIN EXECUTION FLOW VISIBLE

The primary function should tell the story of what happens.

For HTTP handlers, services, WebSocket handlers, jobs, and domain operations, I should understand the main workflow by reading the primary function.

For example:

```go
func (s *RideService) AcceptRide(
    ctx context.Context,
    driverID uuid.UUID,
    rideID uuid.UUID,
) error {
    ride, err := s.queries.GetRide(ctx, rideID)
    if err != nil {
        return fmt.Errorf("get ride: %w", err)
    }

    if ride.Status != "pending" {
        return ErrRideNotAvailable
    }

    err = s.queries.AssignDriver(ctx, db.AssignDriverParams{
        RideID:   rideID,
        DriverID: driverID,
    })
    if err != nil {
        return fmt.Errorf("assign driver: %w", err)
    }

    return nil
}
```

Do NOT turn this into:

```go
func (s *RideService) AcceptRide(...) error {
    ride, err := s.getRide(...)
    if err != nil {
        return err
    }

    if err := s.validateRide(ride); err != nil {
        return err
    }

    return s.assignDriver(...)
}
```

unless those extracted methods actually contain meaningful complexity or are reused.

The business flow should remain visible.

---

# 4. USE CLEAR, DOMAIN-SPECIFIC NAMES

Avoid vague names such as:

```text
data
result
res
obj
item
tmp
val
x
info
thing
payload
stuff
resp
r
v
m
```

unless the scope is extremely small and the meaning is obvious.

Prefer names such as:

```text
ride
driver
passenger
driverLocation
nearbyDrivers
connection
locationUpdate
notification
rideRequest
presenceKey
rateLimit
deliveryResult
pushToken
```

Variable names should communicate business meaning.

---

# 5. AVOID PREMATURE ABSTRACTION

Do not introduce unnecessary:

- interfaces
- generic repositories
- service layers
- managers
- factories
- builders
- strategies
- wrappers
- adapters
- providers
- registries
- event buses
- dependency containers
- generic utilities
- generic CRUD abstractions

unless there is an actual reason in the existing codebase.

Do not design for hypothetical future requirements.

Follow YAGNI.

Solve the current requirement cleanly.

---

# 6. GO INTERFACES SHOULD BE SMALL AND JUSTIFIED

Do NOT create an interface for every struct.

Bad:

```go
type UserRepository interface {
    CreateUser(context.Context, CreateUserParams) error
}
```

when there is only one implementation and no meaningful test or architectural reason.

Prefer concrete dependencies when appropriate:

```go
type UserService struct {
    queries *db.Queries
}
```

Create interfaces when there is a genuine boundary such as:

- external API provider
- push notification provider
- clock
- storage backend
- multiple real implementations
- testing boundary where substitution is valuable

Prefer small interfaces owned by the consuming package.

Do not create large "god interfaces."

---

# 7. DO NOT CREATE A GENERIC REPOSITORY LAYER AROUND SQLC

sqlc already gives typed database access.

Do not create unnecessary wrappers like:

```text
UserRepository
RideRepository
LocationRepository
DatabaseRepository
GenericRepository
```

that merely call sqlc methods one-for-one.

Bad:

```go
func (r *RideRepository) GetRide(ctx context.Context, id uuid.UUID) (db.Ride, error) {
    return r.queries.GetRide(ctx, id)
}
```

This adds indirection without value.

Prefer using generated sqlc queries directly inside the appropriate application/domain service unless the wrapper provides real domain behavior.

---

# 8. KEEP SQL WHERE SQL BELONGS

Use PostgreSQL/PostGIS for operations the database is good at.

Prefer SQL for:

- filtering
- joins
- ordering
- pagination
- aggregation
- geographic distance
- spatial containment
- nearest-neighbor queries
- existence checks
- atomic updates

Do NOT fetch large datasets into Go and filter them manually when PostgreSQL can perform the operation cleanly.

For geospatial operations, use PostGIS rather than implementing geographic calculations manually in Go.

Example:

Prefer:

```sql
SELECT
    id,
    latitude,
    longitude
FROM driver_locations
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $3
);
```

over fetching all driver coordinates into Go and calculating distances manually.

---

# 9. WRITE READABLE SQL

SQL must also be human-readable.

Do not create giant unreadable SQL queries simply to avoid multiple queries.

Use:
- descriptive aliases
- sensible formatting
- CTEs when they genuinely improve comprehension
- comments only for non-obvious behavior

Avoid nested SQL cleverness when a clearer query is possible.

Performance matters, but readability matters too.

If optimizing a query makes it substantially harder to understand, there should be a real measurable reason for the optimization.

---

# 10. SQLC SHOULD REMAIN THE SOURCE OF DATABASE TYPES

Prefer sqlc-generated parameter/result structures where appropriate.

Do not manually duplicate database models unless there is a real separation between:

- database representation
- domain representation
- API response representation

Do not create extra mapping layers automatically.

Mapping is justified when the shapes or responsibilities genuinely differ.

---

# 11. HANDLE PGX ERRORS EXPLICITLY

Do not hide database errors behind generic abstractions.

Use clear error handling.

Example:

```go
ride, err := s.queries.GetRide(ctx, rideID)
if err != nil {
    if errors.Is(err, pgx.ErrNoRows) {
        return ErrRideNotFound
    }

    return fmt.Errorf("get ride: %w", err)
}
```

Preserve error context.

Do not return bare errors from deep operations when adding useful context would make debugging easier.

Prefer:

```go
return fmt.Errorf("create ride: %w", err)
```

instead of:

```go
return err
```

when context is useful.

---

# 12. DO NOT OVER-WRAP ERRORS

Do not produce absurd error chains such as:

```text
service error:
operation failed:
database action failed:
query failed:
get record:
sql error
```

Add one useful contextual layer at meaningful architectural boundaries.

Error messages should tell a developer what operation failed.

---

# 13. USE TRANSACTIONS ONLY WHEN NEEDED

Do not wrap every database operation in a transaction.

Use transactions when multiple operations must succeed or fail atomically.

Keep transaction flow easy to follow.

Prefer explicit transaction code over overly generic transaction helpers if the helper hides important behavior.

Example:

```go
tx, err := s.pool.Begin(ctx)
if err != nil {
    return fmt.Errorf("begin transaction: %w", err)
}
defer tx.Rollback(ctx)

queries := s.queries.WithTx(tx)

if err := queries.AssignDriver(ctx, params); err != nil {
    return fmt.Errorf("assign driver: %w", err)
}

if err := queries.UpdateRideStatus(ctx, statusParams); err != nil {
    return fmt.Errorf("update ride status: %w", err)
}

if err := tx.Commit(ctx); err != nil {
    return fmt.Errorf("commit transaction: %w", err)
}
```

Do not hide the entire transaction behind complicated generic callback machinery unless the project already uses that convention.

---

# 14. CHI HANDLERS SHOULD BE THIN, BUT NOT ARTIFICIALLY THIN

HTTP handlers should generally handle:

1. request parsing
2. validation
3. authentication/authorization context
4. calling application/domain logic
5. mapping errors
6. writing the HTTP response

Do not place substantial business logic directly in handlers.

But also do not create unnecessary service methods for trivial behavior.

Avoid handler code that becomes a maze of wrappers.

The request flow should be obvious.

---

# 15. DO NOT CREATE UNNECESSARY MIDDLEWARE

Middleware should be used for genuinely cross-cutting concerns such as:

- authentication
- request IDs
- logging
- tracing
- CORS
- panic recovery
- rate limiting
- metrics

Do NOT create middleware for behavior that belongs to one or two endpoints.

Endpoint-specific business logic belongs in the handler/service flow.

---

# 16. WEBSOCKET CODE MUST BE EXPLICIT AND EASY TO TRACE

gorilla/websocket code becomes difficult very quickly.

Keep connection lifecycle explicit.

Clearly show:

- upgrade
- authentication
- connection registration
- read loop
- write handling
- ping/pong or heartbeat
- cleanup
- disconnection
- presence updates

Do not hide the lifecycle behind many generic abstractions.

Avoid overly sophisticated hub architectures unless required.

When using a hub, keep the responsibilities obvious.

For example:

```text
Connect
  ↓
Register connection
  ↓
Mark user online
  ↓
Read messages
  ↓
Handle messages
  ↓
Disconnect
  ↓
Remove connection
  ↓
Update presence
```

A developer should be able to follow that flow in the code.

---

# 17. AVOID GOROUTINE MAGIC

Do not launch goroutines casually.

Every goroutine must have a clear lifecycle.

Before starting one, ask:

- Who owns this goroutine?
- When does it terminate?
- What happens when the request/context is cancelled?
- Can it leak?
- Can it block forever?
- Who closes its channels?
- Can it race with cleanup?

Prefer synchronous code unless concurrency is actually useful.

Do not use goroutines merely to make code look asynchronous.

---

# 18. CHANNELS SHOULD HAVE CLEAR OWNERSHIP

Do not create complex channel architectures unless necessary.

When channels are used:

- make ownership clear
- clearly define who sends
- clearly define who receives
- clearly define who closes
- avoid hidden bidirectional behavior
- avoid unnecessary buffering

Do not close a channel from multiple places.

Do not introduce channels when a mutex or normal function call would be simpler.

---

# 19. KEEP CONCURRENCY READABLE

Avoid:
- nested goroutines
- deeply nested select blocks
- unnecessary worker pools
- complicated fan-in/fan-out patterns
- channels used as generic event systems
- concurrency for trivial operations

If concurrency is necessary, write it in the clearest possible way and explain any non-obvious synchronization decisions.

Correctness is more important than clever concurrency.

---

# 20. REDIS SHOULD HAVE A CLEAR PURPOSE

Use Redis for things that fit Redis well, such as:

- presence
- temporary state
- rate limiting
- short-lived location/session information
- distributed coordination when justified
- caches
- pub/sub when genuinely required

Do not move persistent relational data into Redis unnecessarily.

PostgreSQL remains the source of truth for durable application data.

---

# 21. KEEP REDIS KEYS HUMAN-UNDERSTANDABLE

Use predictable key naming.

For example:

```text
presence:user:{user_id}
rate_limit:user:{user_id}
driver:location:{driver_id}
ride:active:{ride_id}
```

Do not construct obscure key schemas without reason.

TTL behavior must be explicit.

When setting a temporary key, clearly define why the TTL exists.

---

# 22. PRESENCE MUST HAVE SIMPLE SEMANTICS

For online/offline presence, clearly define:

- what "online" means
- when presence is written
- when it expires
- what happens on abrupt disconnect
- whether multiple devices/connections are allowed
- how heartbeat refresh works

Do not make presence depend solely on perfectly clean WebSocket disconnect events.

Prefer TTL-based presence where appropriate so crashed connections eventually expire.

---

# 23. RATE LIMITS MUST BE OBVIOUS

Rate limiting should clearly communicate:

- what is being limited
- key used
- time window
- maximum count
- behavior when exceeded

Avoid overly generic rate-limiter abstractions.

The developer reading the endpoint should easily determine the effective limit.

---

# 24. VALIDATION SHOULD BE CLOSE TO THE BOUNDARY

Validate incoming API input near the HTTP/WebSocket boundary.

Do not pass obviously invalid data deep into services.

Examples:
- malformed UUID
- invalid latitude/longitude
- empty required fields
- impossible radius values
- invalid enum values

Business validation still belongs in domain/application logic.

Distinguish input validation from business rules.

---

# 25. DO NOT OVERUSE STRUCT TAGS OR REFLECTION

Avoid reflection-heavy generic systems.

Use explicit Go code when practical.

Do not create generic validation, serialization, or mapping frameworks when existing libraries or straightforward code are easier to understand.

---

# 26. KEEP STRUCTS FOCUSED

Do not create giant structs containing every dependency in the application.

Dependencies should reflect actual responsibility.

Bad:

```go
type Service struct {
    DB            *pgxpool.Pool
    Queries       *db.Queries
    Redis         *redis.Client
    FCM           *messaging.Client
    WebSocketHub  *Hub
    Logger        *slog.Logger
    Config        Config
    Maps          *MapClient
    Everything    *Everything
}
```

Prefer focused services when responsibilities truly differ.

But do not split one cohesive service into ten tiny services either.

Balance matters.

---

# 27. DO NOT CREATE A "UTILS" DUMPING GROUND

Avoid generic packages named:

```text
utils
helpers
common
misc
shared
```

unless there is a clear, cohesive responsibility.

Put functionality close to the domain where it belongs.

A function used by one package should usually live in that package.

---

# 28. PACKAGE STRUCTURE SHOULD REMAIN SIMPLE

Do not use complicated "clean architecture" folder structures by default.

Avoid unnecessary layering such as:

```text
domain/
entities/
usecases/
repositories/
adapters/
ports/
interfaces/
infrastructure/
application/
presentation/
```

unless the existing project genuinely follows that architecture.

Prefer a pragmatic structure that reflects application concepts.

Example:

```text
internal/
  auth/
  users/
  rides/
  drivers/
  locations/
  websocket/
  notifications/
  database/
```

or whatever structure already exists in the repository.

Follow the existing project before inventing a new structure.

---

# 29. DO NOT USE DESIGN PATTERNS JUST BECAUSE THEY EXIST

Do not introduce:

- strategy pattern
- factory pattern
- visitor pattern
- command pattern
- dependency injection containers
- event sourcing
- CQRS
- hexagonal architecture

unless the problem genuinely requires them.

Simple functions and structs are usually preferable.

---

# 30. TYPESCRIPT MUST ALSO BE HUMAN-READABLE

For React Native/TypeScript, follow the same philosophy.

Prefer explicit TypeScript.

Avoid:
- advanced conditional types unless necessary
- deeply nested generic types
- giant utility types
- unnecessary mapped types
- clever infer tricks
- excessive type gymnastics

Types should make the code easier to understand, not harder.

---

# 31. DO NOT CREATE TYPES FOR EVERYTHING

Do not define separate types for trivial values unless they improve safety or clarity.

Do not create duplicate request/response/view-model/domain types when their shapes are identical and separation provides no benefit.

Avoid unnecessary mapping layers.

---

# 32. REACT COMPONENTS SHOULD SHOW THE UI FLOW

A component should be understandable from top to bottom.

Prefer:

1. hooks/state
2. derived values
3. event handlers
4. effects
5. JSX

Do not hide everything inside tiny hooks simply to make the component shorter.

Do not automatically extract:
- every handler
- every small block
- every computed value
- every network call

into another file.

Extract when there is actual reuse, complexity, or conceptual separation.

---

# 33. DO NOT CREATE CUSTOM HOOKS JUST BECAUSE YOU CAN

A custom hook should represent meaningful reusable behavior.

Bad:

```typescript
function useRideId(ride: Ride) {
  return ride.id;
}
```

or a hook used by only one component that merely moves 5 simple lines elsewhere.

Keep simple component-specific logic in the component.

Create hooks for meaningful logic such as:

```text
useCurrentLocation
useRideTracking
useWebSocketConnection
useDriverPresence
usePushNotifications
```

when those hooks contain coherent behavior.

---

# 34. KEEP REACT NATIVE STATE SIMPLE

Prefer local state when state is local.

Do not introduce global state unnecessarily.

Do not create complex reducers or state machines for simple state.

Use:
- `useState`
- `useMemo`
- `useCallback`
- `useReducer`

only where they provide clear value.

Do not add `useMemo` and `useCallback` everywhere by default.

Memoization is an optimization, not a coding style.

---

# 35. DO NOT OVERUSE USEEFFECT

Effects should synchronize with external systems.

Do not use `useEffect` to calculate values that can be calculated during render.

Bad:

```typescript
const [fullName, setFullName] = useState("");

useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);
```

Prefer:

```typescript
const fullName = `${firstName} ${lastName}`;
```

Use effects intentionally.

---

# 36. HANDLE ASYNC LOGIC EXPLICITLY

Network operations should have obvious:

- loading state
- success state
- error state
- cancellation behavior when necessary

Avoid deeply nested promise chains.

Prefer async/await.

Example:

```typescript
try {
  setIsLoading(true);

  const ride = await api.acceptRide(rideId);
  setRide(ride);
} catch (error) {
  setError(getErrorMessage(error));
} finally {
  setIsLoading(false);
}
```

Prefer this over complex chaining.

---

# 37. MAPLIBRE CODE SHOULD BE EASY TO FOLLOW

Map code becomes complex quickly.

Keep concepts separate and explicit:

- user location
- driver location
- markers
- route geometry
- camera behavior
- map interactions
- map style
- tile source

Do not create overly generic map abstraction components.

Prefer clear components with meaningful names:

```text
RideMap
DriverMarker
PickupMarker
DestinationMarker
RouteLine
```

when extraction improves comprehension.

Do not split every MapLibre layer into its own component automatically.

---

# 38. GEOSPATIAL COORDINATES MUST BE EXPLICIT

Be careful with coordinate ordering.

GeoJSON uses:

```text
[longitude, latitude]
```

not:

```text
[latitude, longitude]
```

Use descriptive names.

Prefer:

```typescript
const coordinate: [number, number] = [longitude, latitude];
```

over ambiguous arrays.

On the Go side, also use explicit names:

```go
longitude := req.Longitude
latitude := req.Latitude
```

Avoid `x` and `y` for application-level geospatial coordinates unless working directly with geometry math.

---

# 39. SELF-HOSTED TILE CONFIGURATION SHOULD BE CENTRALIZED

Do not scatter tile URLs or style configuration throughout the app.

Keep environment-specific map configuration in a clear configuration location.

Do not hardcode production tile infrastructure inside UI components.

Make dev/staging/production differences obvious.

---

# 40. FCM PUSH NOTIFICATIONS SHOULD HAVE A SIMPLE FLOW

Push notification behavior should be obvious.

Example:

```text
business event occurs
    ↓
determine recipients
    ↓
fetch valid device tokens
    ↓
construct notification
    ↓
send using FCM
    ↓
handle invalid tokens
```

Do not over-engineer notification architecture unless required.

Do not create a generic event-bus-based notification framework just because multiple notification types may exist.

---

# 41. PUSH NOTIFICATION PAYLOADS SHOULD BE TYPED AND EXPLICIT

Clearly separate:

- visible notification content
- data payload
- event/type identifier
- entity IDs

Example:

```go
data := map[string]string{
    "type":    "ride_assigned",
    "ride_id": rideID.String(),
}
```

Do not use ambiguous keys.

Keep mobile-side parsing equally explicit.

---

# 42. FLY.IO CONFIGURATION SHOULD REMAIN SIMPLE

Deployment configuration should be understandable without reverse engineering.

Avoid unnecessary scripts and abstraction layers around Fly.io.

Keep clearly documented:

- app configuration
- environment variables
- secrets
- health checks
- internal ports
- process commands
- migrations
- regions
- scaling behavior

Do not add infrastructure complexity without a concrete operational reason.

---

# 43. ENVIRONMENT VARIABLES MUST HAVE CLEAR OWNERSHIP

Do not call `os.Getenv()` throughout the entire Go codebase.

Read configuration in one obvious place.

Validate required configuration at application startup.

Prefer a typed config struct.

Example:

```go
type Config struct {
    DatabaseURL string
    RedisURL    string
    FCMProjectID string
}
```

Fail early if required configuration is missing.

---

# 44. AVOID GLOBAL STATE

Do not use package-level mutable global variables for:

- database connections
- Redis clients
- WebSocket connections
- configuration
- FCM clients
- caches

Pass dependencies explicitly.

Global constants are fine.

Mutable application dependencies should have clear ownership.

---

# 45. LOGGING SHOULD HELP DEBUGGING

Use structured logs.

Log meaningful fields:

```go
logger.Error(
    "failed to accept ride",
    "ride_id", rideID,
    "driver_id", driverID,
    "error", err,
)
```

Do not spam logs.

Do not log every successful trivial operation.

Do not log sensitive data.

Do not log an error repeatedly at every layer.

Generally log where the error is actually handled or where operational context is meaningful.

---

# 46. AVOID BOOLEAN ARGUMENT MYSTERIES

Avoid APIs like:

```go
UpdateRide(ctx, ride, true, false)
```

because the meaning is unclear.

Prefer explicit options, named structures, or separate methods when necessary.

Example:

```go
UpdateRideOptions{
    NotifyPassenger: true,
    UpdateLocation:  false,
}
```

But do not create option structs for trivial functions with one obvious parameter.

---

# 47. ENUM-LIKE VALUES SHOULD BE CLEAR

Do not scatter raw string literals throughout the application.

Prefer named constants where the set of values matters.

Example:

```go
type RideStatus string

const (
    RideStatusPending   RideStatus = "pending"
    RideStatusAccepted  RideStatus = "accepted"
    RideStatusCompleted RideStatus = "completed"
)
```

Do not over-engineer enums with unnecessary methods unless those methods provide real value.

---

# 48. COMMENTS EXPLAIN WHY, NOT WHAT

Bad:

```go
// Get the ride
ride, err := queries.GetRide(ctx, rideID)
```

The code already says that.

Useful comment:

```go
// Driver presence uses a TTL because mobile clients may disappear
// without completing the WebSocket close handshake.
```

Comments should explain:
- non-obvious business rules
- technical constraints
- external system limitations
- intentional workarounds
- unusual performance decisions

---

# 49. KEEP ERROR HANDLING BORING

Go error handling is repetitive by design.

Do not hide it behind clever helper functions just because repetition bothers you.

This is acceptable:

```go
ride, err := queries.GetRide(ctx, rideID)
if err != nil {
    return fmt.Errorf("get ride: %w", err)
}
```

Do not create generic functions like:

```go
mustHandle(...)
check(...)
wrap(...)
execute(...)
```

that obscure control flow.

Explicit error handling is often preferable.

---

# 50. DO NOT OVERUSE GENERICS

Use Go generics only where they clearly remove meaningful duplication while preserving readability.

Do not create generic repositories, generic service wrappers, generic API responders, or generic CRUD frameworks unless they genuinely simplify the project.

If ordinary Go code is easier to understand, use ordinary Go code.

---

# 51. LIMIT MAGIC

Avoid behavior that occurs implicitly and is difficult to trace.

Be cautious with:
- init()
- package-level side effects
- reflection
- automatic registration
- hidden callbacks
- magic dependency injection
- background goroutines started implicitly
- global event listeners

Important application behavior should have an obvious starting point.

---

# 52. KEEP HTTP RESPONSE HANDLING CONSISTENT BUT SIMPLE

A small response helper is fine if it removes actual repetition.

For example:

```go
func writeJSON(w http.ResponseWriter, status int, value any)
```

is reasonable.

Do not build a giant generic response framework around it.

API error behavior should be predictable and easy to locate.

---

# 53. AUTHORIZATION MUST BE EXPLICIT

Do not assume authentication automatically implies authorization.

Important operations should clearly verify resource ownership/permissions.

Example:

```go
ride, err := queries.GetRide(ctx, rideID)
if err != nil {
    ...
}

if ride.PassengerID != userID {
    return ErrForbidden
}
```

Do not hide critical authorization behind obscure generic helpers unless that pattern is already established and easy to understand.

---

# 54. SECURITY-SENSITIVE LOGIC SHOULD BE BORING AND OBVIOUS

For authentication, authorization, tokens, location privacy, rate limits, and WebSocket authentication:

Prefer explicit, conventional implementations.

Do not invent custom crypto.

Do not hide security decisions behind abstractions that make them difficult to audit.

---

# 55. VALIDATE LOCATION DATA

Latitude must be within:

```text
-90 to 90
```

Longitude must be within:

```text
-180 to 180
```

Reject obviously invalid coordinates.

Be deliberate about:
- accuracy
- timestamps
- stale location updates
- update frequency
- precision
- privacy

Do not treat every incoming GPS coordinate as equally trustworthy.

---

# 56. DO NOT WRITE EVERYTHING AS A SERVICE

Not every operation needs:

```text
FooService
FooManager
FooHandler
FooRepository
FooProcessor
FooCoordinator
```

Use the simplest abstraction that communicates the responsibility.

Sometimes a function is enough.

Sometimes a struct is appropriate because it has dependencies.

Choose based on actual needs.

---

# 57. KEEP DOMAIN LOGIC CLOSE TO THE DOMAIN

Ride behavior should not be scattered among:

```text
helpers/
utils/
database/
handlers/
controllers/
misc/
```

Keep related behavior close together.

The developer should know where to look for:

- ride acceptance
- ride cancellation
- driver location
- presence
- notifications
- WebSocket behavior

without searching the whole repository.

---

# 58. DO NOT REFACTOR UNRELATED CODE

When I ask you to implement a change:

- modify only what is needed
- preserve existing behavior
- do not rename unrelated functions
- do not reorganize unrelated packages
- do not change formatting throughout unrelated files
- do not introduce architectural changes unless required
- do not "clean up" unrelated code

Keep diffs small and reviewable.

---

# 59. MATCH THE EXISTING CODEBASE

Before writing code, inspect relevant nearby code.

Follow existing conventions for:

- package naming
- constructors
- services
- handlers
- errors
- logging
- database queries
- WebSocket handling
- Redis keys
- TypeScript types
- API clients
- React Native components
- state management
- styling
- tests

Do not impose your preferred architecture on an existing project.

Consistency matters.

---

# 60. DO NOT CREATE FILES UNNECESSARILY

Do not create a new file for every small function, interface, or type.

Keep closely related code together.

Create a new file when:
- the existing file becomes genuinely difficult to navigate
- there is a clear conceptual boundary
- the new file contains a coherent set of behavior

Do not fragment the codebase.

---

# 61. KEEP FILE NAVIGATION LOW

One of the primary goals is reducing how many files a developer must open to understand one feature.

A feature should not require jumping through:

```text
handler
→ interface
→ implementation
→ repository interface
→ repository implementation
→ adapter
→ mapper
→ utility
```

unless that complexity genuinely provides value.

Prefer locality.

---

# 62. TEST BEHAVIOR, NOT IMPLEMENTATION DETAILS

Write tests around observable behavior.

Avoid tests that break simply because an internal private function was renamed or code was rearranged.

For Go:
- prefer table-driven tests where they improve readability
- do not force every test into a giant table
- use clear test names

Example:

```go
func TestAcceptRide_ReturnsErrorWhenRideAlreadyAccepted(t *testing.T)
```

is preferable to vague names.

---

# 63. DO NOT MOCK EVERYTHING

Prefer testing against realistic boundaries when practical.

Do not create massive mock interfaces merely to test trivial code.

Use interfaces/mocks where external boundaries justify them.

For database-heavy logic, consider integration tests when they provide more confidence than mocked repository methods.

---

# 64. EXPLAIN NON-OBVIOUS PERFORMANCE OPTIMIZATIONS

If you introduce:

- Redis caching
- spatial indexes
- batching
- connection pooling changes
- goroutines
- worker queues
- query optimization
- React memoization

there should be a concrete reason.

Do not optimize hypothetically.

When optimization materially increases complexity, briefly explain why it is warranted.

---

# 65. DATABASE INDEXES MUST MATCH REAL QUERY PATTERNS

Do not add indexes blindly.

For PostGIS, use appropriate spatial indexes where necessary.

For normal PostgreSQL queries, choose indexes based on actual:

- filters
- joins
- ordering
- uniqueness constraints

Do not create duplicate or speculative indexes.

---

# 66. DO NOT HIDE BUSINESS RULES IN DATABASE TRIGGERS BY DEFAULT

Prefer business behavior that can be followed from application code unless a database-level rule genuinely belongs in PostgreSQL.

Constraints are good for data integrity.

Triggers should be used deliberately because they make behavior less visible to application developers.

---

# 67. RETURN EARLY WHEN IT IMPROVES CLARITY

Go naturally works well with early returns.

Example:

```go
if err != nil {
    return err
}

if !allowed {
    return ErrForbidden
}
```

But do not turn a function into dozens of disconnected guard clauses if a simple branch would communicate the business logic better.

Optimize for comprehension.

---

# 68. AVOID DEEP NESTING

Prefer:

```go
if err != nil {
    return err
}

if ride.Status != RideStatusPending {
    return ErrRideUnavailable
}

return s.acceptRide(ctx, ride)
```

over:

```go
if err == nil {
    if ride.Status == RideStatusPending {
        if allowed {
            ...
        }
    }
}
```

Keep the happy path obvious.

---

# 69. DO NOT MAKE SIMPLE CODE "ENTERPRISE"

Avoid transforming straightforward application code into architecture-heavy code.

If the requirement is:

"Find nearby drivers and return them"

I do NOT automatically want:

```text
DriverDiscoveryUseCase
DriverLocationProvider
GeoSearchStrategy
DriverRepositoryPort
PostgresDriverRepositoryAdapter
DriverSearchResultMapper
```

A straightforward service + sqlc query may be completely sufficient.

---

# 70. FRONTEND API CLIENTS SHOULD BE SIMPLE

Keep HTTP API calls easy to find.

Do not add unnecessary abstraction layers around `fetch`, Axios, or the project's existing client.

Something like:

```typescript
export async function acceptRide(rideId: string): Promise<Ride> {
  return api.post(`/rides/${rideId}/accept`);
}
```

is often sufficient.

Do not create request factories, command buses, or generic endpoint builders without real need.

---

# 71. WEBSOCKET MESSAGE TYPES SHOULD BE EXPLICIT

Do not pass arbitrary JSON blobs around.

Use clear message types.

Example:

```typescript
type DriverLocationMessage = {
  type: "driver_location";
  driverId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
};
```

On Go, decode into explicit structs when practical.

Do not create a giant generic event abstraction unless necessary.

---

# 72. MAKE MESSAGE FLOW TRACEABLE

For a WebSocket message, I should be able to understand:

```text
client sends event
→ backend decodes event
→ validates it
→ updates state/database
→ broadcasts relevant update
→ mobile client receives event
→ UI updates
```

Do not hide that path across excessive indirection.

---

# 73. AVOID DUPLICATING SOURCE OF TRUTH

Clearly define which system owns which data.

Typical example:

PostgreSQL:
- users
- rides
- durable driver/profile data
- historical records

Redis:
- presence
- short-lived rate limits
- ephemeral state

WebSocket:
- transport, not permanent storage

React Native state:
- client view state

Do not create inconsistent copies of important state without a reconciliation strategy.

---

# 74. WRITE MIGRATIONS CAREFULLY

Database migrations must be:

- explicit
- reversible when reasonably possible
- safe for production data
- aware of locking/large tables when relevant

Do not casually:
- drop columns
- rewrite large tables
- add non-null columns without considering existing rows
- remove indexes

For PostGIS changes, preserve SRID and geometry/geography semantics carefully.

---

# 75. KEEP DEPLOYMENT-SPECIFIC CODE OUT OF BUSINESS LOGIC

Fly.io-specific behavior should live in deployment/configuration boundaries.

Business code should not contain conditions such as:

```go
if os.Getenv("FLY_REGION") == "..."
```

unless region-aware behavior is genuinely part of the application requirement.

Keep infrastructure concerns isolated.

---

# 76. DO NOT INVENT REQUIREMENTS

When implementing a task, do not add extra behavior that I did not request unless necessary for correctness or safety.

Do not add:
- extra endpoints
- extra database fields
- extra caching
- extra background jobs
- extra validation rules
- new abstractions

without a concrete reason.

---

# 77. WHEN SOMETHING IS UNCLEAR, FAVOR THE SIMPLEST CONSISTENT INTERPRETATION

Use existing code and patterns to infer intent.

Do not redesign the project because a requirement has minor ambiguity.

Make the smallest reasonable implementation.

If an assumption materially changes behavior, mention it.

---

# 78. DO NOT USE OBSCURE LANGUAGE FEATURES WITHOUT NEED

In Go, avoid unnecessary:
- reflection
- unsafe
- deeply nested anonymous functions
- complex generic constraints
- unusual synchronization patterns
- custom iterator abstractions

In TypeScript, avoid unnecessary:
- conditional types
- recursive types
- complex mapped types
- overloaded generic functions
- type-level programming

If a normal implementation is easier to understand, use it.

---

# 79. MAKE CODE REVIEW EASY

Imagine every change will be reviewed in a pull request.

The reviewer should be able to answer quickly:

- What changed?
- Why?
- What is the flow?
- What could fail?
- What data changes?
- What external systems are involved?

Prefer small, focused diffs.

Avoid unrelated cleanup.

---

# 80. BEFORE SHOWING ME CODE, PERFORM A READABILITY REVIEW

Before giving me your final implementation, review your own code and ask:

1. Can another Go/TypeScript developer understand this without explanation?
2. Is the main execution flow visible?
3. Did I create any function that is only used once and adds no meaningful abstraction?
4. Did I create unnecessary interfaces?
5. Did I wrap sqlc with a redundant repository?
6. Did I introduce unnecessary layers?
7. Did I use clever Go or TypeScript syntax where simpler syntax would work?
8. Are variables domain-specific and descriptive?
9. Can error behavior be followed easily?
10. Is WebSocket/concurrency lifecycle obvious?
11. Is Redis usage clearly justified?
12. Is Postgres the source of truth where it should be?
13. Is geospatial logic correctly using PostGIS where appropriate?
14. Did I introduce unnecessary React hooks or components?
15. Did I use `useEffect`, `useMemo`, or `useCallback` unnecessarily?
16. Did I add files that do not need to exist?
17. Did I modify unrelated code?
18. Could the implementation be simpler?
19. Could a developer debug this at 2 AM without deciphering abstractions?
20. Does this code look like something an experienced engineer would willingly maintain?

If anything is unnecessarily complex, simplify it before presenting the final code.

---

# 81. WHEN MULTIPLE SOLUTIONS EXIST, PRIORITIZE THEM IN THIS ORDER

Choose based on:

1. Correctness
2. Readability
3. Existing project consistency
4. Simplicity
5. Maintainability
6. Explicit behavior
7. Testability
8. Performance
9. Abstraction elegance

Performance can move higher when there is a concrete performance requirement.

Do not sacrifice readability for hypothetical optimization.

---

# 82. WHEN WRITING A NEW FEATURE

Before implementation:

1. Inspect the relevant existing code.
2. Identify the current request flow.
3. Identify existing conventions.
4. Identify the minimum files requiring changes.
5. Identify database/API impact.
6. Implement the smallest coherent solution.

Do NOT begin by inventing an architecture.

---

# 83. WHEN FIXING A BUG

First understand the actual cause.

Do not:
- add broad defensive code everywhere
- swallow errors
- add random nil checks
- add retries without justification
- refactor unrelated code

Fix the root cause with the smallest safe change.

---

# 84. WHEN REFACTORING

Preserve behavior.

Refactor only the requested area.

Prefer reducing:
- indirection
- duplication
- confusing naming
- deeply nested logic
- oversized responsibilities

Do not increase architecture complexity just to make the code appear "clean."

---

# 85. WHEN YOU PRESENT YOUR SOLUTION

Do not merely dump code.

Briefly state:

- what you changed
- why this approach was chosen
- any important tradeoff
- any database/schema implications
- any concurrency implications
- any deployment implications if applicable

Do not over-explain obvious code.

The implementation itself should remain understandable without relying on the explanation.

---

# FINAL ENGINEERING PRINCIPLE

Write code like an experienced engineer maintaining a real production system.

Prefer code that is:

obvious over clever

explicit over magical

local over scattered

concrete over prematurely abstract

boring over impressive

easy to debug over architecturally fashionable

easy to review over artificially short

easy to maintain over theoretically flexible

Do not optimize for the smallest number of lines.

Optimize for the smallest amount of mental effort required to understand the system.

For this stack in particular:

- let Go remain simple
- let chi remain thin
- let sqlc expose typed SQL rather than wrapping it unnecessarily
- let PostgreSQL/PostGIS perform relational and geographic work
- let Redis handle genuinely ephemeral state
- keep WebSocket lifecycle explicit
- treat goroutines carefully
- keep React Native component flow visible
- keep TypeScript types understandable
- use MapLibre directly without excessive wrappers
- keep FCM notification flow explicit
- keep Fly.io deployment configuration straightforward

Before submitting any code, ask:

"Is this the simplest production-quality implementation that another human developer can immediately understand?"

If not, simplify it.