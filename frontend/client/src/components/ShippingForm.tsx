"use client";

import { ShippingFormInputs, shippingFormSchema } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, Clock3, Truck } from "lucide-react";
import { SubmitHandler, useForm } from "react-hook-form";

const states = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Federal Capital Territory","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
];

const ShippingForm = ({ setShippingForm, initialValues }: { setShippingForm: (data: ShippingFormInputs) => void; initialValues?: Partial<ShippingFormInputs> }) => {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<ShippingFormInputs>({
    resolver: zodResolver(shippingFormSchema),
    defaultValues: { saveAddress: true, deliverySpeed: "standard", state: "Federal Capital Territory", ...initialValues },
  });
  const saveAddress = watch("saveAddress");
  const selectedSpeed = watch("deliverySpeed");
  const handleShippingForm: SubmitHandler<ShippingFormInputs> = (data) => setShippingForm(data);

  const field = (name: keyof ShippingFormInputs, label: string, placeholder: string, type = "text") => (
    <div className="checkout-field">
      <label htmlFor={name}>{label}</label>
      <input id={name} type={type} placeholder={placeholder} {...register(name as never)} />
      {errors[name] && <p className="checkout-field-error">{String(errors[name]?.message)}</p>}
    </div>
  );

  return (
    <form className="checkout-delivery-form" onSubmit={handleSubmit(handleShippingForm)}>
      {field("name", "Recipient's full name", "Full name as shown on your ID")}
      {field("email", "Email address", "you@example.com", "email")}
      <div className="checkout-form-grid">
        {field("phone", "Phone number", "0800 000 0000", "tel")}
        {field("flatSuite", "Flat, suite or building", "e.g. Flat 2, Block C")}
      </div>
      <p className="checkout-field-help">Add your apartment or building details separately from the street address.</p>
      {field("address", "House number and street", "e.g. 12 Aminu Kano Crescent")}
      {field("landmark", "Landmark (optional)", "e.g. Opposite Banex Plaza")}
      <div className="checkout-form-grid">
        {field("area", "Area", "e.g. Wuse 2")}
        {field("city", "Town or city", "e.g. Abuja")}
      </div>
      <div className="checkout-field">
        <label htmlFor="state">State</label>
        <select id="state" {...register("state")}>
          <option value="">Choose a state</option>
          {states.map((state) => <option value={state} key={state}>{state}</option>)}
        </select>
        {errors.state && <p className="checkout-field-error">{errors.state.message}</p>}
      </div>

      <div className="checkout-save-address">
        <label className="checkout-checkbox"><input type="checkbox" {...register("saveAddress")}/><span>Save this address for next time</span></label>
        {saveAddress && field("addressLabel", "Give it a name", "Home, Office, Mum's place…")}
      </div>

      <fieldset className="checkout-delivery-speed">
        <legend>How fast do you need it?</legend>
        <div className="checkout-delivery-speed-options">
          <label className={selectedSpeed === "standard" ? "is-selected" : ""}>
            <input type="radio" value="standard" {...register("deliverySpeed")}/>
            <span className="checkout-speed-top"><Truck size={17}/><strong>Standard</strong><Check size={17}/></span>
            <small>ARRIVES · 2 to 4 working days</small>
            <strong className="checkout-speed-arrival">2 to 4 working days</strong>
            <span className="checkout-speed-foot">From ₦1,500</span>
          </label>
          <label className={selectedSpeed === "express" ? "is-selected" : ""}>
            <input type="radio" value="express" {...register("deliverySpeed")}/>
            <span className="checkout-speed-top"><Clock3 size={17}/><strong>Express</strong><span className="checkout-fastest">Faster option</span></span>
            <small>ARRIVES · Next working day</small>
            <strong className="checkout-speed-arrival">Next working day</strong>
            <span className="checkout-speed-foot">From ₦3,500</span>
          </label>
        </div>
        <p className="checkout-field-help">Fees depend on your area and the size of your order. Sundays are not delivery days. Final delivery fee is confirmed for your address.</p>
      </fieldset>

      <div className="checkout-field">
        <label htmlFor="deliveryNote">Delivery note</label>
        <textarea id="deliveryNote" rows={3} placeholder="Gate codes, best times, or anything the courier should know." {...register("deliveryNote")}/>
        <p className="checkout-field-help">Optional. Help the courier find you.</p>
      </div>

      <button type="submit" className="checkout-primary-action">Continue to payment <ArrowRight size={17}/></button>
    </form>
  );
};

export default ShippingForm;
